//! Detailwerte wie in btop: Kerne, Temperaturen, Speicher, Datenträger,
//! Netzwerk-Schnittstellen, Prozesse und Verbrauch je Container/App.
//!
//! Alles aus `/proc` und `/sys` des Hosts. Werte, die eine Differenz brauchen
//! (Kern-Auslastung, Prozess-CPU), werden gegen den vorherigen Abruf gerechnet.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tokio::sync::Mutex;

use crate::metrics::{CpuSample, cpu_percent, parse_meminfo};

/// Wie viele Prozesse höchstens ausgeliefert werden.
const TOP_PROCESSES: usize = 15;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SystemDetail {
    pub cpu: CpuDetail,
    pub mem: MemDetail,
    pub disks: Vec<DiskUsage>,
    /// Gelesene/geschriebene Bytes aller physischen Laufwerke (Zähler).
    pub disk_read_bytes: Option<u64>,
    pub disk_write_bytes: Option<u64>,
    pub net: Vec<NetInterface>,
    pub processes: Vec<ProcessInfo>,
    pub apps: Vec<AppUsage>,
    pub timestamp_ms: u128,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CpuDetail {
    pub model: Option<String>,
    /// Durchschnittlicher aktueller Takt in MHz.
    pub mhz: Option<f64>,
    /// Auslastung je logischem Kern in Prozent.
    pub cores: Vec<Option<f64>>,
    /// Temperaturen je physischem Kern (coretemp/k10temp), z. B. „Core 0“.
    pub temps: Vec<TempReading>,
    pub package_temp: Option<f64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TempReading {
    pub label: String,
    pub celsius: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct MemDetail {
    pub total: Option<u64>,
    pub used: Option<u64>,
    pub available: Option<u64>,
    pub free: Option<u64>,
    pub cached: Option<u64>,
    pub buffers: Option<u64>,
    pub swap_total: Option<u64>,
    pub swap_used: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiskUsage {
    pub label: String,
    pub total: u64,
    pub used: u64,
    pub free: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NetInterface {
    pub name: String,
    pub rx_bytes: u64,
    pub tx_bytes: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    /// Anteil an der gesamten CPU-Leistung (alle Kerne = 100 %).
    pub cpu_percent: f64,
    pub mem_bytes: u64,
    /// Kurz-ID (12 Zeichen) des Docker-Containers, falls der Prozess in einem läuft.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub container: Option<String>,
}

/// Verbrauch je App (Compose-Projekt bzw. Container).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppUsage {
    /// Compose-Projekt oder Containername; ohne Docker-Metadaten die Container-ID.
    pub name: String,
    pub containers: Vec<String>,
    pub cpu_percent: f64,
    pub mem_bytes: u64,
}

/* ───────────────────────── Parser (rein, testbar) ───────────────────────── */

/// Gesamt- und Einzelkern-Zähler aus `/proc/stat`.
pub fn parse_cpus(stat: &str) -> (Option<CpuSample>, Vec<CpuSample>) {
    let mut total = None;
    let mut cores = Vec::new();
    for line in stat.lines() {
        let Some(rest) = line.strip_prefix("cpu") else { continue };
        let (name, values) = rest.split_once(char::is_whitespace).unwrap_or((rest, ""));
        let v: Vec<u64> = values.split_whitespace().filter_map(|x| x.parse().ok()).collect();
        if v.len() < 4 {
            continue;
        }
        let sum: u64 = v.iter().take(8).sum();
        let idle = v[3] + v.get(4).copied().unwrap_or(0);
        let sample = CpuSample {
            busy: sum - idle,
            total: sum,
        };
        if name.is_empty() {
            total = Some(sample);
        } else if name.bytes().all(|b| b.is_ascii_digit()) {
            cores.push(sample);
        }
    }
    (total, cores)
}

/// CPU-Modell und durchschnittlicher Takt aus `/proc/cpuinfo`.
pub fn parse_cpuinfo(text: &str) -> (Option<String>, Option<f64>) {
    let mut model = None;
    let (mut sum, mut n) = (0.0, 0u32);
    for line in text.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        match key.trim() {
            "model name" | "Model" | "Hardware" if model.is_none() => {
                let v = value.split_whitespace().collect::<Vec<_>>().join(" ");
                if !v.is_empty() {
                    model = Some(v);
                }
            }
            "cpu MHz" => {
                if let Ok(mhz) = value.trim().parse::<f64>() {
                    sum += mhz;
                    n += 1;
                }
            }
            _ => {}
        }
    }
    (model, (n > 0).then(|| (sum / f64::from(n)).round()))
}

/// Felder aus `/proc/<pid>/stat`, die für die Prozessliste gebraucht werden.
#[derive(Debug, Clone, PartialEq)]
pub struct PidStat {
    pub name: String,
    /// utime + stime (Ticks)
    pub ticks: u64,
    /// Startzeit seit Boot (Ticks) – unterscheidet wiederverwendete PIDs.
    pub start: Option<u64>,
    /// Resident Set Size in Seiten (fehlt bei gekürzten Zeilen).
    pub rss_pages: Option<u64>,
}

/// Liest `/proc/<pid>/stat`. Der Name steht in Klammern und darf Leerzeichen und Klammern enthalten.
pub fn parse_pid_stat(text: &str) -> Option<PidStat> {
    let open = text.find('(')?;
    let close = text.rfind(')')?;
    let name = text.get(open + 1..close)?.to_owned();
    let fields: Vec<&str> = text.get(close + 1..)?.split_whitespace().collect();
    // Nach dem Namen: state(0) ppid(1) … utime(11) stime(12) … starttime(19) vsize(20) rss(21)
    let utime: u64 = fields.get(11)?.parse().ok()?;
    let stime: u64 = fields.get(12)?.parse().ok()?;
    Some(PidStat {
        name,
        ticks: utime + stime,
        start: fields.get(19).and_then(|s| s.parse().ok()),
        rss_pages: fields.get(21).and_then(|s| s.parse().ok()),
    })
}

/// pid -> (Startzeit, Container) aus dem vorherigen Durchlauf.
type KnownProcs = HashMap<u32, (Option<u64>, Option<String>)>;

/// Docker-Container-ID (12 Zeichen) aus `/proc/<pid>/cgroup` (cgroup v1 und v2).
pub fn parse_container_id(cgroup: &str) -> Option<String> {
    for line in cgroup.lines() {
        let path = line.rsplit(':').next().unwrap_or("");
        for seg in path.split('/') {
            let seg = seg.strip_prefix("docker-").unwrap_or(seg);
            let seg = seg.strip_suffix(".scope").unwrap_or(seg);
            if seg.len() == 64 && seg.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Some(seg[..12].to_owned());
            }
        }
    }
    None
}

fn is_physical_disk(name: &str) -> bool {
    let digits_after = |prefix: &str| {
        name.strip_prefix(prefix)
            .is_some_and(|r| !r.is_empty() && r.bytes().all(|b| b.is_ascii_digit()))
    };
    let letters_after = |prefix: &str| {
        name.strip_prefix(prefix)
            .is_some_and(|r| !r.is_empty() && r.bytes().all(|b| b.is_ascii_lowercase()))
    };
    letters_after("sd")
        || letters_after("vd")
        || letters_after("xvd")
        || digits_after("mmcblk")
        || name.strip_prefix("nvme").is_some_and(|r| {
            r.split_once('n').is_some_and(|(a, b)| {
                !a.is_empty() && !b.is_empty() && (a.to_owned() + b).bytes().all(|c| c.is_ascii_digit())
            })
        })
}

/// Summe gelesener/geschriebener Bytes physischer Laufwerke aus `/proc/diskstats`.
pub fn parse_diskstats(text: &str) -> Option<(u64, u64)> {
    let (mut read, mut write, mut any) = (0u64, 0u64, false);
    for line in text.lines() {
        let f: Vec<&str> = line.split_whitespace().collect();
        if f.len() < 10 || !is_physical_disk(f[2]) {
            continue;
        }
        if let (Ok(r), Ok(w)) = (f[5].parse::<u64>(), f[9].parse::<u64>()) {
            read += r * 512;
            write += w * 512;
            any = true;
        }
    }
    any.then_some((read, write))
}

/// Physische Netzwerk-Schnittstellen mit Byte-Zählern aus `/proc/net/dev`.
pub fn parse_net_interfaces(text: &str) -> Vec<NetInterface> {
    const VIRTUAL: [&str; 11] = [
        "lo",
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
    ];
    text.lines()
        .skip(2)
        .filter_map(|line| {
            let (name, data) = line.split_once(':')?;
            let name = name.trim();
            if VIRTUAL.iter().any(|p| name == *p || name.starts_with(p)) {
                return None;
            }
            let c: Vec<u64> = data.split_whitespace().filter_map(|v| v.parse().ok()).collect();
            (c.len() >= 9).then(|| NetInterface {
                name: name.to_owned(),
                rx_bytes: c[0],
                tx_bytes: c[8],
            })
        })
        .collect()
}

/// App-Name aus Docker-Metadaten (`config.v2.json`): Compose-Projekt, sonst Containername.
pub fn parse_docker_config(json: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let labels = &v["Config"]["Labels"];
    labels["com.docker.compose.project"]
        .as_str()
        .or_else(|| v["Name"].as_str().map(|n| n.trim_start_matches('/')))
        .map(str::to_owned)
        .filter(|s| !s.is_empty())
}

/* ───────────────────────── Leser ───────────────────────── */

#[derive(Debug, Clone)]
struct Sample {
    total: Option<CpuSample>,
    cores: Vec<CpuSample>,
    /// pid -> (Name, Ticks, RSS-Bytes, Container)
    procs: HashMap<u32, (String, u64, u64, Option<String>)>,
    at: Instant,
}

pub struct SystemReader {
    proc_dir: PathBuf,
    sys_dir: PathBuf,
    data_dir: PathBuf,
    docker_dir: PathBuf,
    last: Mutex<Option<Sample>>,
    names: Mutex<HashMap<String, Option<String>>>,
    known: Arc<StdMutex<KnownProcs>>,
    /// Letztes Ergebnis: Gleichzeitige Abrufe teilen sich einen Durchlauf über `/proc`.
    recent: Mutex<Option<(Instant, SystemDetail)>>,
}

fn read(path: &Path) -> Option<String> {
    fs::read_to_string(path).ok()
}

impl SystemReader {
    pub fn new(proc_dir: PathBuf, sys_dir: PathBuf, data_dir: PathBuf, docker_dir: PathBuf) -> Self {
        Self {
            proc_dir,
            sys_dir,
            data_dir,
            docker_dir,
            last: Mutex::default(),
            names: Mutex::default(),
            known: Arc::default(),
            recent: Mutex::default(),
        }
    }

    /// Ein Durchlauf über `/proc`. Je Prozess wird nur `stat` gelesen; `statm` nur bei
    /// gekürzten Zeilen, `cgroup` nur für neue Prozesse (gleiche PID und Startzeit
    /// bedeuten denselben Prozess und damit denselben Container).
    fn sample(proc_dir: &Path, known: &StdMutex<KnownProcs>) -> Sample {
        let (total, cores) = read(&proc_dir.join("stat"))
            .as_deref()
            .map(parse_cpus)
            .unwrap_or_default();
        let page = 4096u64;
        let mut procs = HashMap::new();
        let previous = std::mem::take(&mut *known.lock().unwrap_or_else(|e| e.into_inner()));
        let mut seen = KnownProcs::with_capacity(previous.len());
        if let Ok(entries) = fs::read_dir(proc_dir) {
            for e in entries.flatten() {
                let Some(pid) = e.file_name().to_str().and_then(|s| s.parse::<u32>().ok()) else {
                    continue;
                };
                let dir = e.path();
                let Some(st) = read(&dir.join("stat")).as_deref().and_then(parse_pid_stat) else {
                    continue;
                };
                let rss = st
                    .rss_pages
                    .or_else(|| read(&dir.join("statm")).and_then(|s| s.split_whitespace().nth(1)?.parse().ok()))
                    .map_or(0, |p: u64| p * page);
                let container = match previous.get(&pid) {
                    Some((start, c)) if st.start.is_some() && *start == st.start => c.clone(),
                    _ => read(&dir.join("cgroup")).as_deref().and_then(parse_container_id),
                };
                seen.insert(pid, (st.start, container.clone()));
                procs.insert(pid, (st.name, st.ticks, rss, container));
            }
        }
        *known.lock().unwrap_or_else(|e| e.into_inner()) = seen;
        Sample {
            total,
            cores,
            procs,
            at: Instant::now(),
        }
    }

    fn temps(sys_dir: &Path) -> (Vec<TempReading>, Option<f64>) {
        let mut temps = Vec::new();
        let mut package = None;
        let Ok(entries) = fs::read_dir(sys_dir.join("class/hwmon")) else {
            return (temps, package);
        };
        for e in entries.flatten() {
            let dir = e.path();
            let name = read(&dir.join("name")).unwrap_or_default();
            if !matches!(name.trim(), "coretemp" | "k10temp" | "zenpower" | "cpu_thermal") {
                continue;
            }
            let mut readings: Vec<(u32, String, f64)> = Vec::new();
            for f in fs::read_dir(&dir).into_iter().flatten().flatten() {
                let fname = f.file_name().to_string_lossy().into_owned();
                let Some(idx) = fname.strip_prefix("temp").and_then(|r| r.strip_suffix("_input")) else {
                    continue;
                };
                let Some(milli) = read(&f.path()).and_then(|s| s.trim().parse::<f64>().ok()) else {
                    continue;
                };
                let label = read(&dir.join(format!("temp{idx}_label")))
                    .map(|s| s.trim().to_owned())
                    .unwrap_or_else(|| format!("Sensor {idx}"));
                readings.push((idx.parse().unwrap_or(0), label, (milli / 100.0).round() / 10.0));
            }
            readings.sort_by_key(|r| r.0);
            for (_, label, c) in readings {
                if label.starts_with("Package") || label == "Tctl" || label == "Tdie" {
                    package = Some(package.map_or(c, |p: f64| p.max(c)));
                } else {
                    temps.push(TempReading { label, celsius: c });
                }
            }
        }
        (temps, package)
    }

    #[cfg(unix)]
    fn disk_usage(path: &Path, label: &str) -> Option<DiskUsage> {
        let s = rustix::fs::statvfs(path).ok()?;
        let unit = if s.f_frsize > 0 { s.f_frsize } else { s.f_bsize };
        let total = s.f_blocks * unit;
        let free = s.f_bavail * unit;
        let used = total.saturating_sub(s.f_bfree * unit);
        (total > 0).then(|| DiskUsage {
            label: label.to_owned(),
            total,
            used,
            free,
        })
    }

    #[cfg(not(unix))]
    fn disk_usage(_path: &Path, _label: &str) -> Option<DiskUsage> {
        None
    }

    async fn app_name(&self, id: &str) -> Option<String> {
        if let Some(cached) = self.names.lock().await.get(id) {
            return cached.clone();
        }
        // config.v2.json liegt unter <docker>/containers/<volle ID>/ – passende ID suchen.
        let dir = self.docker_dir.clone();
        let short = id.to_owned();
        let name = tokio::task::spawn_blocking(move || {
            let entries = fs::read_dir(&dir).ok()?;
            let full = entries
                .flatten()
                .find(|e| e.file_name().to_string_lossy().starts_with(&short))?;
            parse_docker_config(&read(&full.path().join("config.v2.json"))?)
        })
        .await
        .ok()
        .flatten();
        self.names.lock().await.insert(id.to_owned(), name.clone());
        name
    }

    /// Aktuelle Details; Abrufe innerhalb von 2 s bekommen denselben Durchlauf.
    pub async fn snapshot(&self) -> SystemDetail {
        let mut recent = self.recent.lock().await;
        if let Some((_, d)) = recent.as_ref().filter(|(at, _)| at.elapsed() < Duration::from_secs(2)) {
            return d.clone();
        }
        let d = self.measure().await;
        *recent = Some((Instant::now(), d.clone()));
        d
    }

    async fn measure(&self) -> SystemDetail {
        let proc_dir = self.proc_dir.clone();
        let known = self.known.clone();
        let take = move || Self::sample(&proc_dir, &known);
        let mut now = tokio::task::spawn_blocking(take.clone())
            .await
            .unwrap_or_else(|_| Sample {
                total: None,
                cores: Vec::new(),
                procs: HashMap::new(),
                at: Instant::now(),
            });

        let prev = {
            let mut last = self.last.lock().await;
            match last.take() {
                Some(p) if now.at.duration_since(p.at) >= Duration::from_millis(500) => Some(p),
                other => {
                    drop(last);
                    // Erster Abruf (oder zu kurz hintereinander): kurz zweites Mal messen.
                    let base = other.unwrap_or_else(|| now.clone());
                    tokio::time::sleep(Duration::from_millis(400)).await;
                    now = tokio::task::spawn_blocking(take).await.unwrap_or(base.clone());
                    Some(base)
                }
            }
        };

        let cores = now
            .cores
            .iter()
            .enumerate()
            .map(|(i, n)| {
                prev.as_ref()
                    .and_then(|p| p.cores.get(i))
                    .and_then(|p| cpu_percent(*p, *n))
            })
            .collect();

        // Prozess-CPU: Anteil der Ticks an allen Ticks aller Kerne.
        let total_delta = match (prev.as_ref().and_then(|p| p.total), now.total) {
            (Some(p), Some(n)) => n.total.saturating_sub(p.total),
            _ => 0,
        };
        let mut processes: Vec<ProcessInfo> = now
            .procs
            .iter()
            .map(|(pid, (name, ticks, rss, container))| {
                let before = prev.as_ref().and_then(|p| p.procs.get(pid)).map_or(*ticks, |p| p.1);
                let pct = if total_delta > 0 {
                    ticks.saturating_sub(before) as f64 * 100.0 / total_delta as f64
                } else {
                    0.0
                };
                ProcessInfo {
                    pid: *pid,
                    name: name.clone(),
                    cpu_percent: (pct * 100.0).round() / 100.0,
                    mem_bytes: *rss,
                    container: container.clone(),
                }
            })
            .collect();

        // Verbrauch je Container, dann je App zusammenfassen.
        let mut per_container: HashMap<String, (f64, u64)> = HashMap::new();
        for p in &processes {
            if let Some(c) = &p.container {
                let e = per_container.entry(c.clone()).or_default();
                e.0 += p.cpu_percent;
                e.1 += p.mem_bytes;
            }
        }
        let mut apps: HashMap<String, AppUsage> = HashMap::new();
        for (id, (cpu, mem)) in per_container {
            let name = self.app_name(&id).await.unwrap_or_else(|| id.clone());
            let a = apps.entry(name.clone()).or_insert(AppUsage {
                name,
                containers: Vec::new(),
                cpu_percent: 0.0,
                mem_bytes: 0,
            });
            a.containers.push(id);
            a.cpu_percent += cpu;
            a.mem_bytes += mem;
        }
        let mut apps: Vec<AppUsage> = apps.into_values().collect();
        for a in &mut apps {
            a.cpu_percent = (a.cpu_percent * 100.0).round() / 100.0;
            a.containers.sort();
        }
        apps.sort_by(|a, b| {
            b.cpu_percent
                .total_cmp(&a.cpu_percent)
                .then(b.mem_bytes.cmp(&a.mem_bytes))
        });

        processes.sort_by(|a, b| {
            b.cpu_percent
                .total_cmp(&a.cpu_percent)
                .then(b.mem_bytes.cmp(&a.mem_bytes))
        });
        processes.truncate(TOP_PROCESSES);

        let (model, mhz) = read(&self.proc_dir.join("cpuinfo"))
            .as_deref()
            .map(parse_cpuinfo)
            .unwrap_or_default();
        let sys_dir = self.sys_dir.clone();
        let (temps, package_temp) = tokio::task::spawn_blocking(move || Self::temps(&sys_dir))
            .await
            .unwrap_or_default();

        let meminfo = read(&self.proc_dir.join("meminfo")).unwrap_or_default();
        let m = |k| parse_meminfo(&meminfo, k);
        let (total, available) = (m("MemTotal"), m("MemAvailable"));
        let cached = match (m("Cached"), m("SReclaimable")) {
            (Some(c), r) => Some(c + r.unwrap_or(0)),
            _ => None,
        };
        let mem = MemDetail {
            total,
            used: total.zip(available).map(|(t, a)| t.saturating_sub(a)),
            available,
            free: m("MemFree"),
            cached,
            buffers: m("Buffers"),
            swap_total: m("SwapTotal"),
            swap_used: m("SwapTotal").zip(m("SwapFree")).map(|(t, f)| t.saturating_sub(f)),
        };

        let disk = read(&self.proc_dir.join("diskstats"))
            .as_deref()
            .and_then(parse_diskstats);
        *self.last.lock().await = Some(now);

        SystemDetail {
            cpu: CpuDetail {
                model,
                mhz,
                cores,
                temps,
                package_temp,
            },
            mem,
            disks: Self::disk_usage(&self.data_dir, "DATA").into_iter().collect(),
            disk_read_bytes: disk.map(|d| d.0),
            disk_write_bytes: disk.map(|d| d.1),
            net: read(&self.proc_dir.join("net/dev"))
                .as_deref()
                .map(parse_net_interfaces)
                .unwrap_or_default(),
            processes,
            apps,
            timestamp_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_millis()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cpus_total_and_cores() {
        let (t, c) = parse_cpus("cpu  10 0 10 80 0 0 0 0\ncpu0 5 0 5 40 0\ncpu1 5 0 5 40 0\nintr 5\n");
        assert_eq!(t, Some(CpuSample { busy: 20, total: 100 }));
        assert_eq!(c.len(), 2);
        assert_eq!(c[1], CpuSample { busy: 10, total: 50 });
    }

    #[test]
    fn cpuinfo_model_and_mhz() {
        let text = "processor\t: 0\nmodel name\t: 12th Gen Intel(R) Core(TM) i5-1235U\ncpu MHz\t\t: 4000.000\nprocessor\t: 1\nmodel name\t: x\ncpu MHz\t\t: 4600.000\n";
        assert_eq!(
            parse_cpuinfo(text),
            (Some("12th Gen Intel(R) Core(TM) i5-1235U".into()), Some(4300.0))
        );
        assert_eq!(parse_cpuinfo(""), (None, None));
    }

    #[test]
    fn pid_stat_with_tricky_name() {
        let line = "4711 (Plex Media (Serv)) S 1 2 3 4 5 6 7 8 9 10 250 50 0 0 20 0 44 0 100 0";
        let st = parse_pid_stat(line).unwrap();
        assert_eq!(
            (st.name.as_str(), st.ticks, st.start, st.rss_pages),
            ("Plex Media (Serv)", 300, Some(100), None)
        );
        // Vollständige Zeile: rss (Seiten) direkt aus stat, kein statm nötig.
        let full = "7 (x) S 1 2 3 4 5 6 7 8 9 10 250 50 0 0 20 0 44 0 100 123456 2048 18446744073709551615";
        let st = parse_pid_stat(full).unwrap();
        assert_eq!((st.start, st.rss_pages), (Some(100), Some(2048)));
        assert_eq!(parse_pid_stat("garbage"), None);
    }

    #[test]
    fn container_ids_v1_and_v2() {
        let id = "a".repeat(64);
        assert_eq!(
            parse_container_id(&format!("0::/system.slice/docker-{id}.scope\n")),
            Some("a".repeat(12))
        );
        assert_eq!(
            parse_container_id(&format!("12:cpu:/docker/{id}\n")),
            Some("a".repeat(12))
        );
        assert_eq!(parse_container_id("0::/system.slice/zimaos.service\n"), None);
    }

    #[test]
    fn diskstats_only_whole_disks() {
        let text = "   8       0 sda 10 0 100 0 20 0 200 0 0 0 0\n   8       1 sda1 1 0 50 0 1 0 50 0 0 0 0\n 259       0 nvme0n1 1 0 10 0 1 0 20 0 0 0 0\n 259       1 nvme0n1p1 1 0 9 0 1 0 9 0 0 0 0\n   7       0 loop0 1 0 99 0 0 0 0 0 0 0 0\n";
        assert_eq!(parse_diskstats(text), Some(((100 + 10) * 512, (200 + 20) * 512)));
        assert!(is_physical_disk("mmcblk0"));
        assert!(!is_physical_disk("mmcblk0p1"));
        assert!(!is_physical_disk("sda1"));
    }

    #[test]
    fn net_interfaces() {
        let text = "h\nh\n  eth0: 100 1 0 0 0 0 0 0 200 1 0 0 0 0 0 0\n  lo: 5 0 0 0 0 0 0 0 5 0 0 0 0 0 0 0\nveth1: 1 0 0 0 0 0 0 0 1 0 0 0 0 0 0 0\n";
        assert_eq!(
            parse_net_interfaces(text),
            vec![NetInterface {
                name: "eth0".into(),
                rx_bytes: 100,
                tx_bytes: 200
            }]
        );
    }

    #[test]
    fn docker_config_names() {
        assert_eq!(
            parse_docker_config(r#"{"Name":"/plex","Config":{"Labels":{"com.docker.compose.project":"plex-app"}}}"#),
            Some("plex-app".into())
        );
        assert_eq!(
            parse_docker_config(r#"{"Name":"/immich_server","Config":{"Labels":{}}}"#),
            Some("immich_server".into())
        );
        assert_eq!(parse_docker_config("nope"), None);
    }

    #[tokio::test]
    async fn snapshot_groups_processes_into_apps() {
        let tmp = tempfile::tempdir().unwrap();
        let proc_dir = tmp.path().join("proc");
        let docker = tmp.path().join("docker");
        let id = format!("{}{}", "b".repeat(12), "c".repeat(52));
        std::fs::create_dir_all(docker.join(&id)).unwrap();
        std::fs::write(
            docker.join(&id).join("config.v2.json"),
            r#"{"Name":"/plex","Config":{"Labels":{"com.docker.compose.project":"plex"}}}"#,
        )
        .unwrap();
        let write_proc = |pid: u32, name: &str, ticks: u64, in_container: bool| {
            let d = proc_dir.join(pid.to_string());
            std::fs::create_dir_all(&d).unwrap();
            std::fs::write(
                d.join("stat"),
                format!("{pid} ({name}) S 1 1 1 0 0 0 0 0 0 0 {ticks} 0 0 0"),
            )
            .unwrap();
            std::fs::write(d.join("statm"), "100 25 0 0 0 0 0").unwrap();
            let cg = if in_container {
                format!("0::/system.slice/docker-{id}.scope")
            } else {
                "0::/init.scope".into()
            };
            std::fs::write(d.join("cgroup"), cg).unwrap();
        };
        std::fs::create_dir_all(&proc_dir).unwrap();
        std::fs::write(proc_dir.join("stat"), "cpu  0 0 0 1000 0 0 0 0\ncpu0 0 0 0 1000 0\n").unwrap();
        write_proc(10, "Plex Media Serv", 0, true);
        write_proc(11, "Plex Transcoder", 0, true);
        write_proc(12, "sshd", 0, false);

        let reader = SystemReader::new(proc_dir.clone(), tmp.path().join("sys"), tmp.path().into(), docker);
        let _ = reader.measure().await; // Basis (ohne 2-s-Zwischenspeicher)
        // 200 Ticks vergehen, davon 30 + 20 in Plex, 10 in sshd
        std::fs::write(proc_dir.join("stat"), "cpu  60 0 0 1140 0 0 0 0\ncpu0 60 0 0 1140 0\n").unwrap();
        write_proc(10, "Plex Media Serv", 30, true);
        write_proc(11, "Plex Transcoder", 20, true);
        write_proc(12, "sshd", 10, false);
        tokio::time::sleep(Duration::from_millis(550)).await;
        let d = reader.measure().await;

        assert_eq!(d.cpu.cores, vec![Some(30.0)]);
        assert_eq!(d.processes[0].name, "Plex Media Serv");
        assert_eq!(d.processes[0].cpu_percent, 15.0);
        assert_eq!(d.apps.len(), 1);
        assert_eq!(d.apps[0].name, "plex");
        assert_eq!(d.apps[0].cpu_percent, 25.0);
        assert_eq!(d.apps[0].mem_bytes, 2 * 25 * 4096);
    }
}
