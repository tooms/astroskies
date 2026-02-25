import { useState, useEffect, useCallback, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

// ── SunCalc (inline minimal implementation) ──────────────────────────────────
const SunCalc = {
  toRad: (d) => (d * Math.PI) / 180,
  getMoonIllumination(date) {
    const d = (date - new Date(2000, 0, 1, 12)) / 86400000;
    const M = this.toRad(357.5291 + 0.98560028 * d);
    const ML = this.toRad(218.3165 + 13.17639648 * d);
    const L2 = this.toRad(282.9404 + 4.70935e-5 * d);
    const eviction = 1.2739 * Math.sin(this.toRad(2 * ((ML - L2) * 180 / Math.PI)) - M * 180 / Math.PI * this.toRad(1));
    const phase = ((ML.valueOf() - L2.valueOf() + this.toRad(eviction * 10)) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    return { fraction: (1 - Math.cos(phase)) / 2, phase: phase / (2 * Math.PI) };
  },
  getTimes(date, lat, lng) {
    const J1970 = 2440588, J2000 = 2451545;
    const dayMs = 86400000;
    const toJulian = (d) => d / dayMs - 0.5 + J1970;
    const fromJulian = (j) => new Date((j + 0.5 - J1970) * dayMs);
    const toDays = (d) => toJulian(d) - J2000;
    const toRad = this.toRad;
    const days = toDays(date);
    const lw = toRad(-lng), phi = toRad(lat);
    const M = toRad(357.5291 + 0.98560028 * days);
    const L = M + toRad(1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M)) + toRad(282.9372);
    const dec = Math.asin(Math.sin(toRad(-23.45)) * Math.cos(toRad(360 / 365 * (days + 10))));
    const J0 = 0.0009;
    const Jnoon = J2000 + J0 + (0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L)) + lw / (2 * Math.PI);
    const getTime = (h) => {
      try {
        const w = Math.acos((Math.sin(toRad(h)) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
        return { rise: fromJulian(Jnoon - w / (2 * Math.PI) - J0), set: fromJulian(Jnoon + w / (2 * Math.PI) + J0) };
      } catch { return null; }
    };
    return {
      sunrise: getTime(-0.833)?.rise,
      sunset: getTime(-0.833)?.set,
      astronomicalDawn: getTime(-18)?.rise,
      astronomicalDusk: getTime(-18)?.set,
    };
  },
};

// ── Geocoding via Nominatim (OpenStreetMap, no key required) ──────────────────
async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`;
  const res = await fetch(url, { headers: { "Accept-Language": "en" } });
  if (!res.ok) throw new Error("Geocoding failed");
  return res.json(); // [{display_name, lat, lon, ...}]
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const celsiusToF = (c) => Math.round(c * 9 / 5 + 32);
const fmt = (c, unit) => unit === "C" ? `${Math.round(c)}°C` : `${celsiusToF(c)}°F`;
const cloudPct = (raw) => Math.round((raw / 9) * 100);
const formatTime = (date) => date ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--";

function conditionLabel(cloudcover, seeing, transparency) {
  if (cloudcover <= 10 && seeing >= 7 && transparency >= 7) return { label: "Excellent", color: "#00ffc8", icon: "✦" };
  if (cloudcover <= 25 && seeing >= 5 && transparency >= 5) return { label: "Good", color: "#a3f07f", icon: "◉" };
  if (cloudcover <= 50) return { label: "Fair", color: "#f0d97f", icon: "◎" };
  if (cloudcover <= 75) return { label: "Poor", color: "#f0a97f", icon: "◑" };
  return { label: "Cloudy", color: "#f07f7f", icon: "●" };
}

function moonPhaseLabel(phase) {
  if (phase < 0.03 || phase > 0.97) return { label: "New Moon", icon: "🌑" };
  if (phase < 0.22) return { label: "Waxing Crescent", icon: "🌒" };
  if (phase < 0.28) return { label: "First Quarter", icon: "🌓" };
  if (phase < 0.47) return { label: "Waxing Gibbous", icon: "🌔" };
  if (phase < 0.53) return { label: "Full Moon", icon: "🌕" };
  if (phase < 0.72) return { label: "Waning Gibbous", icon: "🌖" };
  if (phase < 0.78) return { label: "Last Quarter", icon: "🌗" };
  return { label: "Waning Crescent", icon: "🌘" };
}

// ── Tooltip ───────────────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "rgba(10,14,28,0.97)", border: "1px solid #1e2d5a", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#c8d8ff" }}>
      <p style={{ margin: "0 0 6px", color: "#7090dd", fontFamily: "monospace" }}>{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ margin: "2px 0", color: p.color }}>
          {p.name}: <strong>{p.value}{p.name === "Cloud Cover" ? "%" : "/8"}</strong>
        </p>
      ))}
    </div>
  );
};

// ── Stars component ───────────────────────────────────────────────────────────
const stars = Array.from({ length: 80 }, (_, i) => ({
  id: i,
  w: (Math.sin(i * 7.3) * 0.5 + 0.5) * 2 + 1,
  top: (Math.sin(i * 3.7) * 0.5 + 0.5) * 100,
  left: (Math.cos(i * 2.9) * 0.5 + 0.5) * 100,
  opacity: (Math.sin(i * 5.1) * 0.5 + 0.5) * 0.7 + 0.2,
  dur: (Math.sin(i * 1.3) * 0.5 + 0.5) * 3 + 2,
  delay: (Math.cos(i * 2.1) * 0.5 + 0.5) * 3,
}));

// ── Location Search Component ─────────────────────────────────────────────────
function LocationSearch({ onSelect }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const debounceRef = useRef(null);
  const wrapRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    setSearchError(null);
    clearTimeout(debounceRef.current);
    if (val.trim().length < 2) { setResults([]); setOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await geocode(val);
        setResults(data);
        setOpen(true);
      } catch { setSearchError("Location lookup failed"); }
      finally { setSearching(false); }
    }, 400);
  };

  const handleSelect = (r) => {
    const shortName = r.display_name.split(",").slice(0, 3).join(",");
    setQuery(shortName);
    setOpen(false);
    setResults([]);
    onSelect({ name: shortName, lat: parseFloat(r.lat), lon: parseFloat(r.lon) });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const data = await geocode(query);
      if (!data.length) { setSearchError("No location found"); return; }
      handleSelect(data[0]);
    } catch { setSearchError("Location lookup failed"); }
    finally { setSearching(false); }
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", minWidth: 260 }}>
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 6 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#4a6080", fontSize: 14, pointerEvents: "none" }}>⌕</span>
          <input
            type="text"
            value={query}
            onChange={handleChange}
            onFocus={() => results.length && setOpen(true)}
            placeholder="Search location…"
            style={S.searchInput}
            autoComplete="off"
          />
          {searching && (
            <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "#4a90ff", fontSize: 12, animation: "spin 1s linear infinite", display: "inline-block" }}>✦</span>
          )}
        </div>
        <button type="submit" style={S.searchBtn} disabled={searching}>Go</button>
      </form>
      {searchError && <p style={{ color: "#f07f7f", fontSize: 11, marginTop: 4, fontFamily: "Space Mono" }}>{searchError}</p>}
      {open && results.length > 0 && (
        <div style={S.dropdown}>
          {results.map((r, i) => {
            const parts = r.display_name.split(",");
            return (
              <div key={i} onClick={() => handleSelect(r)} style={S.dropdownItem} className="dropdown-item">
                <span style={{ color: "#c8d8ff", fontSize: 13 }}>{parts[0]}</span>
                <span style={{ color: "#4a6080", fontSize: 11, marginLeft: 6 }}>{parts.slice(1, 3).join(",")}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function AstroWeather() {
  const [city, setCity] = useState({ name: "Mauna Kea, Hawaii", lat: 19.8207, lon: -155.4681 });
  const [unit, setUnit] = useState("C");
  const [astroData, setAstroData] = useState(null);
  const [civilData, setCivilData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAstroData(null);
    setCivilData(null);
    try {
      const [ar, cr] = await Promise.all([
        fetch(`https://www.7timer.info/bin/api.pl?lon=${city.lon}&lat=${city.lat}&product=astro&output=json`),
        fetch(`https://www.7timer.info/bin/api.pl?lon=${city.lon}&lat=${city.lat}&product=civil&output=json`),
      ]);
      const [astro, civil] = await Promise.all([ar.json(), cr.json()]);
      setAstroData(astro);
      setCivilData(civil);
    } catch (e) {
      setError("Failed to load forecast. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [city]);

  useEffect(() => { load(); }, [load]);

  // 48-hour chart data
  const chartData = astroData ? astroData.dataseries.slice(0, 16).map((d, i) => {
    const dt = new Date(astroData.init.replace(/(\d{4})(\d{2})(\d{2})(\d{2})/, "$1-$2-$3T$4:00:00Z"));
    dt.setHours(dt.getHours() + i * 3);
    return {
      time: dt.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit" }),
      "Cloud Cover": cloudPct(d.cloudcover),
      "Seeing": d.seeing,
      "Transparency": d.transparency,
    };
  }) : [];

  // 7-day forecast
  const sevenDay = (() => {
    if (!civilData) return [];
    const days = {};
    const base = new Date(civilData.init.replace(/(\d{4})(\d{2})(\d{2})(\d{2})/, "$1-$2-$3T$4:00:00Z"));
    civilData.dataseries.slice(0, 56).forEach((d, i) => {
      const dt = new Date(base);
      dt.setHours(dt.getHours() + i * 3);
      const key = dt.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
      if (!days[key]) days[key] = { temps: [], clouds: [], date: dt };
      days[key].temps.push(d.temp2m ?? 0);
      days[key].clouds.push(d.cloudcover ?? 0);
    });
    return Object.entries(days).slice(0, 7).map(([label, v]) => ({
      label,
      high: Math.max(...v.temps),
      low: Math.min(...v.temps),
      avgCloud: Math.round(v.clouds.reduce((a, b) => a + b, 0) / v.clouds.length),
    }));
  })();

  const now = new Date();
  const moon = SunCalc.getMoonIllumination(now);
  const moonInfo = moonPhaseLabel(moon.phase);
  const sunTimes = SunCalc.getTimes(now, city.lat, city.lon);
  const current = astroData?.dataseries?.[0];
  const currentCond = current ? conditionLabel(cloudPct(current.cloudcover), current.seeing, current.transparency) : null;
  const currentTemp = civilData?.dataseries?.[0]?.temp2m;

  return (
    <div style={S.root}>
      <style>{CSS}</style>

      {/* Stars */}
      <div style={S.starfield} aria-hidden>
        {stars.map((s) => (
          <div key={s.id} style={{
            position: "absolute",
            width: s.w + "px", height: s.w + "px",
            background: "white", borderRadius: "50%",
            top: s.top + "%", left: s.left + "%",
            opacity: s.opacity,
            animation: `twinkle ${s.dur}s ease-in-out ${s.delay}s infinite alternate`,
          }} />
        ))}
      </div>

      <div style={S.container}>
        {/* Header */}
        <header style={S.header}>
          <div>
            <h1 style={S.title}><span style={{ color: "#4a90ff" }}>✦</span> AstroSkies</h1>
            <p style={S.subtitle}>Astrophotography Forecast</p>
            <p style={{ color: "#4a90ff", fontSize: 12, marginTop: 6, fontFamily: "Space Mono", letterSpacing: 1 }}>
              ⌖ {city.name}
            </p>
          </div>
          <div style={S.controls}>
            <LocationSearch onSelect={setCity} />
            <button onClick={() => setUnit((u) => u === "C" ? "F" : "C")} style={S.toggle}>
              °{unit === "C" ? "F" : "C"}
            </button>
          </div>
        </header>

        {loading && (
          <div style={{ textAlign: "center", padding: "80px 0" }}>
            <div style={{ fontSize: 40, animation: "spin 1.5s linear infinite", display: "inline-block", color: "#4a90ff" }}>✦</div>
            <p style={{ marginTop: 16, fontFamily: "Space Mono, monospace", fontSize: 13, color: "#4a6080" }}>Scanning the skies…</p>
          </div>
        )}

        {error && <div style={{ textAlign: "center", padding: 40, color: "#f07f7f", fontFamily: "Space Mono" }}>⚠ {error}</div>}

        {!loading && !error && astroData && (
          <div style={{ animation: "fadeUp 0.5s ease" }}>

            {/* Top row */}
            <div style={S.topGrid}>
              <div className="card" style={{ gridColumn: "span 1" }}>
                <p style={S.label}>Current Conditions</p>
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 10 }}>
                  <span style={{ fontSize: 52, lineHeight: 1 }}>{currentCond?.icon}</span>
                  <div>
                    <p style={{ fontFamily: "Space Mono", fontSize: 28, fontWeight: 700, color: currentCond?.color }}>{currentCond?.label}</p>
                    {currentTemp != null && <p style={{ fontSize: 20, color: "#c8d8ff", marginTop: 4 }}>{fmt(currentTemp, unit)}</p>}
                  </div>
                </div>
                {current && (
                  <div style={S.metrics}>
                    {[
                      { l: "Cloud Cover", v: `${cloudPct(current.cloudcover)}%`, pct: cloudPct(current.cloudcover), c: "#f07f7f" },
                      { l: "Seeing", v: `${current.seeing}/8`, pct: (current.seeing / 8) * 100, c: "#4a90ff" },
                      { l: "Transparency", v: `${current.transparency}/8`, pct: (current.transparency / 8) * 100, c: "#00ffc8" },
                      { l: "Wind Speed", v: `${current.wind10m?.speed ?? "–"} km/h`, pct: null, c: "#c8d8ff" },
                    ].map(({ l, v, pct, c }) => (
                      <div key={l}>
                        <p style={{ fontSize: 10, color: "#4a6080", textTransform: "uppercase", letterSpacing: 1 }}>{l}</p>
                        <p style={{ fontFamily: "Space Mono", color: c, fontSize: 15, margin: "3px 0" }}>{v}</p>
                        {pct != null && <div style={S.barOut}><div style={{ ...S.barIn, width: pct + "%", background: c }} /></div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="card">
                <p style={S.label}>Moon</p>
                <div style={{ textAlign: "center", marginTop: 12 }}>
                  <span style={{ fontSize: 50 }}>{moonInfo.icon}</span>
                  <p style={{ fontFamily: "Space Mono", color: "#c8d8ff", fontSize: 13, marginTop: 8 }}>{moonInfo.label}</p>
                  <p style={{ color: "#4a6080", fontSize: 12, marginTop: 4 }}>{Math.round(moon.fraction * 100)}% illuminated</p>
                </div>
              </div>

              <div className="card">
                <p style={S.label}>Twilight Times</p>
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                  {[
                    { l: "Astro. Dawn", v: sunTimes.astronomicalDawn, c: "#f0a97f" },
                    { l: "Sunrise", v: sunTimes.sunrise, c: "#ffd07f" },
                    { l: "Sunset", v: sunTimes.sunset, c: "#f07f7f" },
                    { l: "Astro. Dusk", v: sunTimes.astronomicalDusk, c: "#7fa0f0" },
                  ].map(({ l, v, c }) => (
                    <div key={l} style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#4a6080", fontSize: 13 }}>{l}</span>
                      <span style={{ fontFamily: "Space Mono", color: c, fontSize: 13 }}>{formatTime(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 48hr Chart */}
            <div className="card" style={{ marginBottom: 20 }}>
              <p style={S.label}>48-Hour Forecast</p>
              <p style={{ color: "#2a3a5a", fontSize: 11, margin: "4px 0 16px", fontFamily: "Space Mono" }}>
                Cloud Cover (%) · Seeing (1-8) · Transparency (1-8) · every 3 hours
              </p>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={chartData} margin={{ top: 4, right: 8, left: -24, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,140,255,0.07)" />
                  <XAxis dataKey="time" tick={{ fill: "#3a5070", fontSize: 9, fontFamily: "Space Mono" }} interval={2} />
                  <YAxis tick={{ fill: "#3a5070", fontSize: 9, fontFamily: "Space Mono" }} domain={[0, 100]} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ color: "#7090aa", fontSize: 11, fontFamily: "Space Mono" }} />
                  <Line type="monotone" dataKey="Cloud Cover" stroke="#f07f7f" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Seeing" stroke="#4a90ff" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Transparency" stroke="#00ffc8" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* 7-day */}
            <div className="card">
              <p style={S.label}>7-Day Forecast</p>
              <div style={S.dayGrid}>
                {sevenDay.map((day) => {
                  const cond = conditionLabel(day.avgCloud * 11, 5, 5);
                  const parts = day.label.split(", ");
                  return (
                    <div key={day.label} className="day-card">
                      <p style={{ fontFamily: "Space Mono", fontSize: 12, color: "#7090aa" }}>{parts[0]}</p>
                      <p style={{ fontSize: 11, color: "#3a5070", marginTop: 2 }}>{parts.slice(1).join(", ")}</p>
                      <div style={{ fontSize: 30, margin: "10px 0", lineHeight: 1 }}>{cond.icon}</div>
                      <p style={{ fontSize: 11, color: cond.color, fontFamily: "Space Mono" }}>{cond.label}</p>
                      <div style={{ marginTop: 10 }}>
                        <span style={{ color: "#ffd07f", fontFamily: "Space Mono", fontSize: 13 }}>{fmt(day.high, unit)}</span>
                        <span style={{ color: "#2a3a5a", margin: "0 4px" }}>/</span>
                        <span style={{ color: "#4a6080", fontFamily: "Space Mono", fontSize: 13 }}>{fmt(day.low, unit)}</span>
                      </div>
                      <p style={{ color: "#3a5070", fontSize: 11, marginTop: 6 }}>
                        ☁ <span style={{ fontFamily: "Space Mono" }}>{Math.min(Math.round(day.avgCloud * 11), 100)}%</span>
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        )}

        <footer style={{ textAlign: "center", padding: "24px 0 8px", color: "#1e2d4a", fontSize: 10, fontFamily: "Space Mono" }}>
          Data: 7Timer! · Moon & Twilight: SunCalc
        </footer>
      </div>
    </div>
  );
}

const S = {
  root: { minHeight: "100vh", background: "linear-gradient(160deg,#060a14 0%,#080d1e 60%,#050b16 100%)", fontFamily: "Outfit,sans-serif", color: "#c8d8ff", position: "relative", overflowX: "hidden" },
  starfield: { position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 },
  container: { maxWidth: 980, margin: "0 auto", padding: "24px 16px", position: "relative", zIndex: 1 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16, marginBottom: 28 },
  title: { fontFamily: "Space Mono,monospace", fontSize: "clamp(20px,5vw,32px)", fontWeight: 700, letterSpacing: 2, color: "#e8f0ff" },
  subtitle: { color: "#2a4060", fontSize: 12, letterSpacing: 4, textTransform: "uppercase", marginTop: 4 },
  controls: { display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" },
  searchInput: { width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(100,140,255,0.2)", borderRadius: 8, color: "#c8d8ff", padding: "8px 32px 8px 28px", fontSize: 13, fontFamily: "Outfit,sans-serif", outline: "none", minWidth: 200 },
  searchBtn: { background: "rgba(74,144,255,0.15)", border: "1px solid rgba(74,144,255,0.35)", borderRadius: 8, color: "#4a90ff", padding: "8px 14px", cursor: "pointer", fontFamily: "Space Mono,monospace", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" },
  dropdown: { position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, background: "#0a0f22", border: "1px solid rgba(100,140,255,0.2)", borderRadius: 10, zIndex: 100, overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.6)" },
  dropdownItem: { padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid rgba(100,140,255,0.06)", transition: "background 0.15s" },
  toggle: { background: "rgba(74,144,255,0.12)", border: "1px solid rgba(74,144,255,0.35)", borderRadius: 8, color: "#4a90ff", padding: "8px 16px", cursor: "pointer", fontFamily: "Space Mono,monospace", fontSize: 13, fontWeight: 700 },
  topGrid: { display: "grid", gridTemplateColumns: "1fr minmax(130px,170px) minmax(130px,170px)", gap: 16, marginBottom: 20 },
  label: { fontFamily: "Space Mono,monospace", fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: "#2a4060", marginBottom: 4 },
  metrics: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 20px", marginTop: 16 },
  barOut: { width: "100%", height: 3, background: "rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden", marginTop: 4 },
  barIn: { height: "100%", borderRadius: 2, transition: "width 0.4s ease" },
  dayGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 10, marginTop: 14 },
};

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Outfit:wght@300;400;600;700&display=swap');
  * { box-sizing: border-box; }
  .dropdown-item:hover { background: rgba(74,144,255,0.1); }
  select option { background: #0d1428; }
  @keyframes twinkle { from { opacity: 0.15; } to { opacity: 0.9; } }
  @keyframes fadeUp { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
  @keyframes spin { to { transform:rotate(360deg); } }
  .card { background: rgba(255,255,255,0.025); border: 1px solid rgba(100,140,255,0.12); border-radius: 16px; padding: 20px; backdrop-filter: blur(12px); transition: border-color 0.2s; }
  .card:hover { border-color: rgba(100,140,255,0.28); }
  .day-card { background: rgba(255,255,255,0.02); border: 1px solid rgba(100,140,255,0.08); border-radius: 12px; padding: 14px 10px; text-align: center; transition: all 0.2s; }
  .day-card:hover { background: rgba(100,140,255,0.07); transform: translateY(-2px); border-color: rgba(100,140,255,0.2); }
  @media (max-width: 640px) {
    .top-grid { grid-template-columns: 1fr !important; }
  }
`;
