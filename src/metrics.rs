//! Systemwerte des Hosts aus `/proc` und `/sys` (für Mods wie „Forge Pulse“).

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CpuSample {
    pub busy: u64,
    pub total: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Metrics {
    /// CPU-Auslastung 0–100.
    pub cpu_percent: Option<f64>,
    pub cpu_cores: Option<usize>,
    pub mem_total: Option<u64>,
    pub mem_available: Option<u64>,
    pub mem_percent: Option<f64>,
    pub swap_total: Option<u64>,
    pub swap_free: Option<u64>,
    pub load: Option<[f64; 3]>,
    pub uptime_seconds: Option<f64>,
    /// Höchste Temperatur aller Thermal-Zonen in °C.
    pub temperature: Option<f64>,
    /// Leistungsaufnahme der CPU-Pakete in Watt (RAPL), falls verfügbar.
    pub power_watts: Option<f64>,
    /// Summe empfangener/gesendeter Bytes physischer Schnittstellen (Zähler).
    pub net_rx_bytes: Option<u64>,
    pub net_tx_bytes: Option<u64>,
    /// Zeitstempel in Millisekunden für Ratenberechnung im Browser.
    pub timestamp_ms: u128,
}

pub fn parse_cpu(stat: &str) -> Option<CpuSample> {
    let line = stat.lines().find(|l| l.starts_with("cpu "))?;
    let values: Vec<u64> = line.split_whitespace().skip(1).filter_map(|v| v.parse().ok()).collect();
    if values.len() < 4 {
        return None;
    }
    // user nice system idle iowait irq softirq steal (guest ist in user enthalten)
    let total: u64 = values.iter().take(8).sum();
    let idle = values[3] + values.get(4).copied().unwrap_or(0);
    Some(CpuSample {
        busy: total - idle,
        total,
    })
}

pub fn count_cores(stat: &str) -> usize {
    stat.lines()
        .filter(|l| l.starts_with("cpu") && l.as_bytes().get(3).is_some_and(u8::is_ascii_digit))
        .count()
}

pub fn cpu_percent(prev: CpuSample, next: CpuSample) -> Option<f64> {
    let total = next.total.checked_sub(prev.total)?;
    let busy = next.busy.checked_sub(prev.busy)?;
    (total > 0).then(|| round1(busy as f64 * 100.0 / total as f64))
}

/// Werte aus `/proc/meminfo` in Bytes.
pub fn parse_meminfo(text: &str, key: &str) -> Option<u64> {
    text.lines().find_map(|line| {
        let rest = line.strip_prefix(key)?.strip_prefix(':')?;
        let kb: u64 = rest.split_whitespace().next()?.parse().ok()?;
        Some(kb * 1024)
    })
}

pub fn parse_loadavg(text: &str) -> Option<[f64; 3]> {
    let mut it = text.split_whitespace().map(|v| v.parse::<f64>().ok());
    Some([it.next()??, it.next()??, it.next()??])
}

pub fn parse_uptime(text: &str) -> Option<f64> {
    text.split_whitespace().next()?.parse().ok()
}

/// Summiert Bytes physischer Schnittstellen (ohne lo, docker, veth, br-, virbr, tun/tap).
pub fn parse_net_dev(text: &str) -> Option<(u64, u64)> {
    let mut rx = 0;
    let mut tx = 0;
    let mut any = false;
    for line in text.lines().skip(2) {
        let Some((name, data)) = line.split_once(':') else {
            continue;
        };
        let name = name.trim();
        if name == "lo"
            || [
                "docker",
                "veth",
                "br-",
                "virbr",
                "tun",
                "tap",
                "zt",
                "tailscale",
                "cni",
                "flannel",
            ]
            .iter()
            .any(|p| name.starts_with(p))
        {
            continue;
        }
        let cols: Vec<u64> = data.split_whitespace().filter_map(|v| v.parse().ok()).collect();
        if cols.len() >= 9 {
            rx += cols[0];
            tx += cols[8];
            any = true;
        }
    }
    any.then_some((rx, tx))
}

fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

/// Energiezähler einer RAPL-Zone (`/sys/class/powercap/intel-rapl:N`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RaplZone {
    pub name: String,
    pub energy_uj: u64,
    pub max_uj: u64,
}

/// Leistungsaufnahme in Watt aus zwei Zähler-Ständen; berücksichtigt Überläufe.
pub fn power_watts(prev: &[RaplZone], next: &[RaplZone], seconds: f64) -> Option<f64> {
    if seconds <= 0.0 {
        return None;
    }
    let mut joules_uj: u64 = 0;
    let mut matched = false;
    for n in next {
        let Some(p) = prev.iter().find(|p| p.name == n.name) else {
            continue;
        };
        let delta = if n.energy_uj >= p.energy_uj {
            n.energy_uj - p.energy_uj
        } else {
            // Zähler übergelaufen
            n.max_uj.saturating_sub(p.energy_uj).saturating_add(n.energy_uj)
        };
        joules_uj = joules_uj.saturating_add(delta);
        matched = true;
    }
    matched.then(|| round1(joules_uj as f64 / 1_000_000.0 / seconds))
}

/// Ein Messzeitpunkt für Werte, die eine Differenz brauchen (CPU, Leistung).
#[derive(Debug, Clone)]
struct DeltaSample {
    cpu: Option<CpuSample>,
    rapl: Vec<RaplZone>,
    at: std::time::Instant,
}

pub struct MetricsReader {
    proc_dir: PathBuf,
    sys_dir: PathBuf,
    last: Mutex<Option<DeltaSample>>,
    /// Letztes Ergebnis: Gleichzeitige Abrufe (mehrere Tabs/Geräte) teilen sich eine Messung.
    recent: Mutex<Option<(std::time::Instant, Metrics)>>,
}

impl MetricsReader {
    pub fn new(proc_dir: PathBuf, sys_dir: PathBuf) -> Self {
        Self {
            proc_dir,
            sys_dir,
            last: Mutex::new(None),
            recent: Mutex::new(None),
        }
    }

    /// Top-Level-Zonen (Pakete), z. B. `intel-rapl:0` – nicht die Unterzonen `intel-rapl:0:0`.
    async fn rapl(&self) -> Vec<RaplZone> {
        let base = self.sys_dir.join("class/powercap");
        let Ok(mut dir) = tokio::fs::read_dir(&base).await else {
            return Vec::new();
        };
        let mut zones = Vec::new();
        while let Ok(Some(entry)) = dir.next_entry().await {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.starts_with("intel-rapl:") || name.matches(':').count() != 1 {
                continue;
            }
            let read_u64 = |file: &'static str| {
                let path = entry.path().join(file);
                async move { Self::read(&path).await.and_then(|v| v.trim().parse::<u64>().ok()) }
            };
            if let Some(energy_uj) = read_u64("energy_uj").await {
                let max_uj = read_u64("max_energy_range_uj").await.unwrap_or(u64::MAX);
                zones.push(RaplZone {
                    name,
                    energy_uj,
                    max_uj,
                });
            }
        }
        zones
    }

    async fn delta_sample(&self) -> DeltaSample {
        DeltaSample {
            cpu: Self::read(&self.proc_dir.join("stat"))
                .await
                .as_deref()
                .and_then(parse_cpu),
            rapl: self.rapl().await,
            at: std::time::Instant::now(),
        }
    }

    /// CPU-Auslastung und Leistung seit dem letzten Abruf. Beim ersten Abruf
    /// (oder wenn sich nichts bewegt hat) wird kurz ein zweites Mal gemessen.
    async fn deltas(&self) -> (Option<f64>, Option<f64>) {
        let mut now = self.delta_sample().await;
        let mut last = self.last.lock().await;
        let usable = |prev: &DeltaSample, now: &DeltaSample| match (prev.cpu, now.cpu) {
            (Some(p), Some(n)) => n.total > p.total,
            _ => now.at.duration_since(prev.at) >= Duration::from_millis(200),
        };
        let prev = match last.take() {
            Some(prev) if usable(&prev, &now) => prev,
            _ => {
                let prev = now;
                tokio::time::sleep(Duration::from_millis(250)).await;
                now = self.delta_sample().await;
                prev
            }
        };
        let cpu = match (prev.cpu, now.cpu) {
            (Some(p), Some(n)) => cpu_percent(p, n),
            _ => None,
        };
        let watts = power_watts(&prev.rapl, &now.rapl, now.at.duration_since(prev.at).as_secs_f64());
        *last = Some(now);
        (cpu, watts)
    }

    async fn read(path: &Path) -> Option<String> {
        tokio::fs::read_to_string(path).await.ok()
    }

    async fn temperature(&self) -> Option<f64> {
        let mut dir = tokio::fs::read_dir(self.sys_dir.join("class/thermal")).await.ok()?;
        let mut max: Option<f64> = None;
        while let Ok(Some(entry)) = dir.next_entry().await {
            if !entry.file_name().to_string_lossy().starts_with("thermal_zone") {
                continue;
            }
            if let Some(milli) = Self::read(&entry.path().join("temp"))
                .await
                .and_then(|t| t.trim().parse::<f64>().ok())
            {
                let c = milli / 1000.0;
                if (-40.0..150.0).contains(&c) {
                    max = Some(max.map_or(c, |m: f64| m.max(c)));
                }
            }
        }
        max.map(round1)
    }

    /// Aktuelle Werte; Abrufe innerhalb einer Sekunde bekommen dieselbe Messung.
    pub async fn snapshot(&self) -> Metrics {
        let mut recent = self.recent.lock().await;
        if let Some((_, m)) = recent.as_ref().filter(|(at, _)| at.elapsed() < Duration::from_secs(1)) {
            return m.clone();
        }
        let m = self.measure().await;
        *recent = Some((std::time::Instant::now(), m.clone()));
        m
    }

    async fn measure(&self) -> Metrics {
        let stat = Self::read(&self.proc_dir.join("stat")).await;
        let (cpu_percent, power_watts) = self.deltas().await;

        let meminfo = Self::read(&self.proc_dir.join("meminfo")).await.unwrap_or_default();
        let mem_total = parse_meminfo(&meminfo, "MemTotal");
        let mem_available = parse_meminfo(&meminfo, "MemAvailable");
        let mem_percent = match (mem_total, mem_available) {
            (Some(t), Some(a)) if t > 0 => Some(round1((t.saturating_sub(a)) as f64 * 100.0 / t as f64)),
            _ => None,
        };
        let net = Self::read(&self.proc_dir.join("net/dev"))
            .await
            .as_deref()
            .and_then(parse_net_dev);

        Metrics {
            cpu_percent,
            cpu_cores: stat.as_deref().map(count_cores).filter(|c| *c > 0),
            mem_total,
            mem_available,
            mem_percent,
            swap_total: parse_meminfo(&meminfo, "SwapTotal"),
            swap_free: parse_meminfo(&meminfo, "SwapFree"),
            load: Self::read(&self.proc_dir.join("loadavg"))
                .await
                .as_deref()
                .and_then(parse_loadavg),
            uptime_seconds: Self::read(&self.proc_dir.join("uptime"))
                .await
                .as_deref()
                .and_then(parse_uptime),
            temperature: self.temperature().await,
            power_watts,
            net_rx_bytes: net.map(|n| n.0),
            net_tx_bytes: net.map(|n| n.1),
            timestamp_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_millis()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const STAT: &str =
        "cpu  100 0 50 800 50 0 0 0 0 0\ncpu0 50 0 25 400 25 0 0 0 0 0\ncpu1 50 0 25 400 25 0 0 0 0 0\nintr 1\n";

    #[test]
    fn cpu() {
        let a = parse_cpu(STAT).unwrap();
        assert_eq!(a, CpuSample { busy: 150, total: 1000 });
        assert_eq!(count_cores(STAT), 2);
        let b = CpuSample { busy: 200, total: 1100 };
        assert_eq!(cpu_percent(a, b), Some(50.0));
        assert_eq!(cpu_percent(b, a), None);
        assert_eq!(cpu_percent(a, a), None);
    }

    #[test]
    fn memory_load_uptime() {
        let mem = "MemTotal:       16000 kB\nMemFree: 1 kB\nMemAvailable:    4000 kB\n";
        assert_eq!(parse_meminfo(mem, "MemTotal"), Some(16000 * 1024));
        assert_eq!(parse_meminfo(mem, "MemAvailable"), Some(4000 * 1024));
        assert_eq!(parse_meminfo(mem, "Mem"), None);
        assert_eq!(parse_loadavg("0.50 1.00 2.25 1/100 42"), Some([0.5, 1.0, 2.25]));
        assert_eq!(parse_loadavg("x"), None);
        assert_eq!(parse_uptime("1234.56 999.00"), Some(1234.56));
    }

    #[test]
    fn net_dev_skips_virtual_interfaces() {
        let text = "Inter-|   Receive\n face |bytes\n    lo: 999 1 0 0 0 0 0 0 999 1 0 0 0 0 0 0\n  eth0: 100 1 0 0 0 0 0 0 200 1 0 0 0 0 0 0\ndocker0: 5 1 0 0 0 0 0 0 5 1 0 0 0 0 0 0\n  wlan0: 1 1 0 0 0 0 0 0 2 1 0 0 0 0 0 0\n";
        assert_eq!(parse_net_dev(text), Some((101, 202)));
    }

    #[tokio::test]
    async fn snapshot_from_fake_proc() {
        let tmp = tempfile::tempdir().unwrap();
        let proc_dir = tmp.path().join("proc");
        let sys_dir = tmp.path().join("sys");
        std::fs::create_dir_all(proc_dir.join("net")).unwrap();
        std::fs::create_dir_all(sys_dir.join("class/thermal/thermal_zone0")).unwrap();
        std::fs::write(proc_dir.join("stat"), STAT).unwrap();
        std::fs::write(proc_dir.join("meminfo"), "MemTotal: 1000 kB\nMemAvailable: 250 kB\n").unwrap();
        std::fs::write(proc_dir.join("loadavg"), "1 2 3 1/1 1").unwrap();
        std::fs::write(sys_dir.join("class/thermal/thermal_zone0/temp"), "48500\n").unwrap();
        let reader = MetricsReader::new(proc_dir, sys_dir);
        let m = reader.snapshot().await;
        assert_eq!(m.mem_percent, Some(75.0));
        assert_eq!(m.cpu_cores, Some(2));
        assert_eq!(m.temperature, Some(48.5));
        assert_eq!(m.load, Some([1.0, 2.0, 3.0]));
        assert_eq!(m.uptime_seconds, None);
    }

    #[test]
    fn power_from_rapl_counters() {
        let z = |name: &str, e: u64| RaplZone {
            name: name.into(),
            energy_uj: e,
            max_uj: 1_000_000_000,
        };
        // 25 J in 2 s über zwei Pakete = 12,5 W
        let prev = [z("intel-rapl:0", 1_000_000), z("intel-rapl:1", 5_000_000)];
        let next = [z("intel-rapl:0", 16_000_000), z("intel-rapl:1", 15_000_000)];
        assert_eq!(power_watts(&prev, &next, 2.0), Some(12.5));
        // Überlauf: 999_000_000 -> 4_000_000 bei max 1e9 = 5 J in 1 s
        assert_eq!(
            power_watts(&[z("intel-rapl:0", 999_000_000)], &[z("intel-rapl:0", 4_000_000)], 1.0),
            Some(5.0)
        );
        assert_eq!(power_watts(&[], &next, 1.0), None);
        assert_eq!(power_watts(&prev, &next, 0.0), None);
    }

    // Doppelpunkte in Ordnernamen gibt es nur unter Unix (wie im echten /sys).
    #[cfg(unix)]
    #[tokio::test]
    async fn rapl_reads_only_package_zones() {
        let tmp = tempfile::tempdir().unwrap();
        let sys = tmp.path().join("sys");
        for (zone, e) in [
            ("intel-rapl:0", "1000"),
            ("intel-rapl:0:0", "999999"),
            ("intel-rapl-mmio:0", "5"),
        ] {
            let d = sys.join("class/powercap").join(zone);
            std::fs::create_dir_all(&d).unwrap();
            std::fs::write(d.join("energy_uj"), e).unwrap();
        }
        let reader = MetricsReader::new(tmp.path().join("proc"), sys);
        let zones = reader.rapl().await;
        assert_eq!(zones.len(), 1);
        assert_eq!(zones[0].name, "intel-rapl:0");
        assert_eq!(zones[0].max_uj, u64::MAX);
    }
}
