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
    const J1970 = 2440588, J2000 = 2451545, dayMs = 86400000;
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

// ── Geocoding via local proxy (avoids Nominatim CORS block) ──────────────────
async function geocode(query) {
  const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error("Geocoding failed");
  return res.json();
}

async function reverseGeocode(lat, lon) {
  const res = await fetch(`/api/geocode?lat=${lat}&lon=${lon}&reverse=1`);
  if (!res.ok) throw new Error("Reverse geocoding failed");
  return res.json();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const celsiusToF = (c) => Math.round(c * 9 / 5 + 32);
const fmt = (c, unit) => unit === "C" ? `${Math.round(c)}°C` : `${celsiusToF(c)}°F`;
const cloudPct = (raw) => Math.round((raw / 9) * 100);
const formatTime = (date) => date ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--";

function conditionLabel(cloudcover, seeing, transparency) {
  if (cloudcover <= 10 && seeing >= 7 && transparency >= 7) return { label: "Excellent", color: "#00ffc8", icon: "✦" };
  if (cloudcover <= 25 && seeing >= 5 && transparency >= 5) return { label: "Good",      color: "#a3f07f", icon: "◉" };
  if (cloudcover <= 50)                                     return { label: "Fair",       color: "#f0d97f", icon: "◎" };
  if (cloudcover <= 75)                                     return { label: "Poor",       color: "#f0a97f", icon: "◑" };
  return                                                           { label: "Cloudy",     color: "#f07f7f", icon: "●" };
}

function moonPhaseLabel(phase) {
  if (phase < 0.03 || phase > 0.97) return { label: "New Moon",        icon: "🌑" };
  if (phase < 0.22)                  return { label: "Waxing Crescent", icon: "🌒" };
  if (phase < 0.28)                  return { label: "First Quarter",   icon: "🌓" };
  if (phase < 0.47)                  return { label: "Waxing Gibbous",  icon: "🌔" };
  if (phase < 0.53)                  return { label: "Full Moon",       icon: "🌕" };
  if (phase < 0.72)                  return { label: "Waning Gibbous",  icon: "🌖" };
  if (phase < 0.78)                  return { label: "Last Quarter",    icon: "🌗" };
  return                                    { label: "Waning Crescent", icon: "🌘" };
}

// ── Chart Tooltip ─────────────────────────────────────────────────────────────
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

// ── Deterministic stars ───────────────────────────────────────────────────────
const stars = Array.from({ length: 80 }, (_, i) => ({
  id: i,
  w:     (Math.sin(i * 7.3) * 0.5 + 0.5) * 2 + 1,
  top:   (Math.sin(i * 3.7) * 0.5 + 0.5) * 100,
  left:  (Math.cos(i * 2.9) * 0.5 + 0.5) * 100,
  opacity: (Math.sin(i * 5.1) * 0.5 + 0.5) * 0.7 + 0.2,
  dur:   (Math.sin(i * 1.3) * 0.5 + 0.5) * 3 + 2,
  delay: (Math.cos(i * 2.1) * 0.5 + 0.5) * 3,
}));

// ── Location Search ───────────────────────────────────────────────────────────
function LocationSearch({ onSelect }) {
  const [query, setQuery]           = useState("");
  const [results, setResults]       = useState([]);
  const [searching, setSearching]   = useState(false);
  const [open, setOpen]             = useState(false);
  const [searchError, setSearchError] = useState(null);
  const debounceRef = useRef(null);
  const wrapRef     = useRef(null);

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
      finally   { setSearching(false); }
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
    finally   { setSearching(false); }
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%" }}>
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 6 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#4a6080", fontSize: 14, pointerEvents: "none" }}>⌕</span>
          <input
            type="text"
            value={query}
            onChange={handleChange}
            onFocus={() => results.length && setOpen(true)}
            placeholder="Search any location…"
            style={{
              width: "100%", background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(100,140,255,0.2)", borderRadius: 8,
              color: "#c8d8ff", padding: "9px 32px 9px 28px",
              fontSize: 14, fontFamily: "Outfit,sans-serif", outline: "none",
            }}
            autoComplete="off"
          />
          {searching && (
            <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "#4a90ff", fontSize: 12, animation: "spin 1s linear infinite", display: "inline-block" }}>✦</span>
          )}
        </div>
        <button type="submit" style={{
          background: "rgba(74,144,255,0.15)", border: "1px solid rgba(74,144,255,0.35)",
          borderRadius: 8, color: "#4a90ff", padding: "9px 16px",
          cursor: "pointer", fontFamily: "Space Mono,monospace", fontSize: 13,
          fontWeight: 700, whiteSpace: "nowrap",
        }} disabled={searching}>Go</button>
      </form>
      {searchError && <p style={{ color: "#f07f7f", fontSize: 11, marginTop: 4, fontFamily: "Space Mono" }}>{searchError}</p>}
      {open && results.length > 0 && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0,
          background: "#0a0f22", border: "1px solid rgba(100,140,255,0.2)",
          borderRadius: 10, zIndex: 200, overflow: "hidden",
          boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
        }}>
          {results.map((r, i) => {
            const parts = r.display_name.split(",");
            return (
              <div key={i} onClick={() => handleSelect(r)} className="dropdown-item" style={{ padding: "11px 14px", cursor: "pointer", borderBottom: "1px solid rgba(100,140,255,0.06)" }}>
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

// ── Metric Bar ────────────────────────────────────────────────────────────────
function MetricBar({ label, value, pct, color }) {
  return (
    <div>
      <p style={{ fontSize: 10, color: "#4a6080", textTransform: "uppercase", letterSpacing: 1 }}>{label}</p>
      <p style={{ fontFamily: "Space Mono,monospace", color, fontSize: 15, margin: "3px 0" }}>{value}</p>
      {pct != null && (
        <div style={{ width: "100%", height: 3, background: "rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ width: pct + "%", height: "100%", background: color, borderRadius: 2, transition: "width 0.4s ease" }} />
        </div>
      )}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
const FALLBACK_CITY = { name: "Mauna Kea, Hawaii", lat: 19.8207, lon: -155.4681 };

export default function AstroWeather() {
  const [city, setCity]         = useState(null);
  const [unit, setUnit]         = useState("C");
  const [astroData, setAstroData] = useState(null);
  const [civilData, setCivilData] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [locating, setLocating] = useState(true);

  // Detect user's location on first load
  useEffect(() => {
    if (!navigator.geolocation) {
      setCity(FALLBACK_CITY);
      setLocating(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const { latitude: lat, longitude: lon } = coords;
          const data = await reverseGeocode(lat, lon);
          const parts = data.display_name?.split(",") ?? [];
          const name  = parts.slice(0, 3).join(",").trim() || `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
          setCity({ name, lat, lon });
        } catch {
          const { latitude: lat, longitude: lon } = coords;
          setCity({ name: `${lat.toFixed(2)}, ${lon.toFixed(2)}`, lat, lon });
        } finally {
          setLocating(false);
        }
      },
      () => {
        // User denied permission or geolocation unavailable
        setCity(FALLBACK_CITY);
        setLocating(false);
      },
      { timeout: 8000 }
    );
  }, []);

  const load = useCallback(async () => {
    if (!city) return;
    setLoading(true);
    setError(null);
    setAstroData(null);
    setCivilData(null);
    try {
      const [ar, cr] = await Promise.all([
        fetch(`/api/forecast?lat=${city.lat}&lon=${city.lon}&product=astro`),
        fetch(`/api/forecast?lat=${city.lat}&lon=${city.lon}&product=civil`),
      ]);
      const [astro, civil] = await Promise.all([ar.json(), cr.json()]);
      setAstroData(astro);
      setCivilData(civil);
    } catch {
      setError("Failed to load forecast. Check your connection or proxy config.");
    } finally {
      setLoading(false);
    }
  }, [city]);

  useEffect(() => { if (city) load(); }, [load, city]);

  // 48-hour chart data (16 points × 3h = 48h)
  const chartData = astroData
    ? astroData.dataseries.slice(0, 16).map((d, i) => {
        const dt = new Date(astroData.init.replace(/(\d{4})(\d{2})(\d{2})(\d{2})/, "$1-$2-$3T$4:00:00Z"));
        dt.setHours(dt.getHours() + i * 3);
        return {
          time: dt.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit" }),
          "Cloud Cover": cloudPct(d.cloudcover),
          "Seeing": d.seeing,
          "Transparency": d.transparency,
        };
      })
    : [];

  // 7-day forecast
  const sevenDay = (() => {
    if (!civilData) return [];
    const days = {};
    const base = new Date(civilData.init.replace(/(\d{4})(\d{2})(\d{2})(\d{2})/, "$1-$2-$3T$4:00:00Z"));
    civilData.dataseries.slice(0, 56).forEach((d, i) => {
      const dt = new Date(base);
      dt.setHours(dt.getHours() + i * 3);
      const key = dt.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
      if (!days[key]) days[key] = { temps: [], clouds: [] };
      days[key].temps.push(d.temp2m ?? 0);
      days[key].clouds.push(d.cloudcover ?? 0);
    });
    return Object.entries(days).slice(0, 7).map(([label, v]) => ({
      label,
      high: Math.max(...v.temps),
      low:  Math.min(...v.temps),
      avgCloud: Math.round(v.clouds.reduce((a, b) => a + b, 0) / v.clouds.length),
    }));
  })();

  const now          = new Date();
  const moon         = SunCalc.getMoonIllumination(now);
  const moonInfo     = moonPhaseLabel(moon.phase);
  const sunTimes     = city ? SunCalc.getTimes(now, city.lat, city.lon) : {};
  const current      = astroData?.dataseries?.[0];
  const currentCond  = current ? conditionLabel(cloudPct(current.cloudcover), current.seeing, current.transparency) : null;
  const currentTemp  = civilData?.dataseries?.[0]?.temp2m;

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg,#060a14 0%,#080d1e 60%,#050b16 100%)", fontFamily: "Outfit,sans-serif", color: "#c8d8ff", position: "relative", overflowX: "hidden" }}>
      <style>{CSS}</style>

      {/* Star field */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }} aria-hidden>
        {stars.map((s) => (
          <div key={s.id} style={{
            position: "absolute", width: s.w + "px", height: s.w + "px",
            background: "white", borderRadius: "50%",
            top: s.top + "%", left: s.left + "%", opacity: s.opacity,
            animation: `twinkle ${s.dur}s ease-in-out ${s.delay}s infinite alternate`,
          }} />
        ))}
      </div>

      <div className="container">

        {/* ── Header ── */}
        <header className="header">
          <div className="header-brand">
            <h1 className="title"><span style={{ color: "#4a90ff" }}>✦</span> AstroSkies</h1>
            <p className="subtitle">Astrophotography Forecast</p>
            <p className="location-label">⌖ {city?.name}</p>
          </div>
          <div className="header-controls">
            <LocationSearch onSelect={setCity} />
            <button
              onClick={() => setUnit((u) => u === "C" ? "F" : "C")}
              className="unit-toggle"
            >
              °{unit === "C" ? "F" : "C"}
            </button>
          </div>
        </header>

        {/* ── Loading ── */}
        {(locating || loading) && (
          <div style={{ textAlign: "center", padding: "80px 0" }}>
            <div style={{ fontSize: 40, animation: "spin 1.5s linear infinite", display: "inline-block", color: "#4a90ff" }}>✦</div>
            <p style={{ marginTop: 16, fontFamily: "Space Mono,monospace", fontSize: 13, color: "#4a6080" }}>
              {locating ? "Detecting your location…" : "Scanning the skies…"}
            </p>
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div style={{ textAlign: "center", padding: 40, color: "#f07f7f", fontFamily: "Space Mono,monospace" }}>⚠ {error}</div>
        )}

        {/* ── Content ── */}
        {!locating && !loading && !error && astroData && city && (
          <div style={{ animation: "fadeUp 0.5s ease" }}>

            {/* Top info grid: conditions | moon | twilight */}
            <div className="top-grid">

              {/* Current Conditions */}
              <div className="card conditions-card">
                <p className="card-label">Current Conditions</p>
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 52, lineHeight: 1 }}>{currentCond?.icon}</span>
                  <div>
                    <p style={{ fontFamily: "Space Mono,monospace", fontSize: "clamp(20px,5vw,28px)", fontWeight: 700, color: currentCond?.color }}>{currentCond?.label}</p>
                    {currentTemp != null && <p style={{ fontSize: 20, color: "#c8d8ff", marginTop: 4 }}>{fmt(currentTemp, unit)}</p>}
                  </div>
                </div>
                {current && (
                  <div className="metrics-grid">
                    <MetricBar label="Cloud Cover"  value={`${cloudPct(current.cloudcover)}%`}    pct={cloudPct(current.cloudcover)}       color="#f07f7f" />
                    <MetricBar label="Seeing"        value={`${current.seeing}/8`}                 pct={(current.seeing / 8) * 100}         color="#4a90ff" />
                    <MetricBar label="Transparency"  value={`${current.transparency}/8`}           pct={(current.transparency / 8) * 100}   color="#00ffc8" />
                    <MetricBar label="Wind Speed"    value={`${current.wind10m?.speed ?? "–"} km/h`} pct={null}                             color="#c8d8ff" />
                  </div>
                )}
              </div>

              {/* Moon */}
              <div className="card moon-card">
                <p className="card-label">Moon</p>
                <div style={{ textAlign: "center", marginTop: 12 }}>
                  <span style={{ fontSize: 50 }}>{moonInfo.icon}</span>
                  <p style={{ fontFamily: "Space Mono,monospace", color: "#c8d8ff", fontSize: 13, marginTop: 8 }}>{moonInfo.label}</p>
                  <p style={{ color: "#4a6080", fontSize: 12, marginTop: 4 }}>{Math.round(moon.fraction * 100)}% illuminated</p>
                </div>
              </div>

              {/* Twilight */}
              <div className="card twilight-card">
                <p className="card-label">Twilight Times</p>
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                  {[
                    { l: "Astro. Dawn", v: sunTimes.astronomicalDawn, c: "#f0a97f" },
                    { l: "Sunrise",     v: sunTimes.sunrise,          c: "#ffd07f" },
                    { l: "Sunset",      v: sunTimes.sunset,           c: "#f07f7f" },
                    { l: "Astro. Dusk", v: sunTimes.astronomicalDusk, c: "#7fa0f0" },
                  ].map(({ l, v, c }) => (
                    <div key={l} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "#4a6080", fontSize: 13 }}>{l}</span>
                      <span style={{ fontFamily: "Space Mono,monospace", color: c, fontSize: 13, whiteSpace: "nowrap" }}>{formatTime(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 48-Hour Chart */}
            <div className="card" style={{ marginBottom: 20 }}>
              <p className="card-label">48-Hour Forecast</p>
              <p style={{ color: "#2a3a5a", fontSize: 11, margin: "4px 0 16px", fontFamily: "Space Mono,monospace" }}>
                Cloud Cover (%) · Seeing (1–8) · Transparency (1–8) · every 3 hours
              </p>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 4, right: 8, left: -28, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,140,255,0.07)" />
                  <XAxis dataKey="time" tick={{ fill: "#3a5070", fontSize: 9, fontFamily: "Space Mono" }} interval={2} />
                  <YAxis tick={{ fill: "#3a5070", fontSize: 9, fontFamily: "Space Mono" }} domain={[0, 100]} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ color: "#7090aa", fontSize: 11, fontFamily: "Space Mono" }} />
                  <Line type="monotone" dataKey="Cloud Cover"  stroke="#f07f7f" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Seeing"       stroke="#4a90ff" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Transparency" stroke="#00ffc8" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* 7-Day Forecast */}
            <div className="card">
              <p className="card-label">7-Day Forecast</p>
              <div className="day-grid">
                {sevenDay.map((day) => {
                  const cond  = conditionLabel(day.avgCloud * 11, 5, 5);
                  const parts = day.label.split(", ");
                  return (
                    <div key={day.label} className="day-card">
                      <p style={{ fontFamily: "Space Mono,monospace", fontSize: 12, color: "#7090aa" }}>{parts[0]}</p>
                      <p style={{ fontSize: 11, color: "#3a5070", marginTop: 2 }}>{parts.slice(1).join(", ")}</p>
                      <div style={{ fontSize: 28, margin: "10px 0", lineHeight: 1 }}>{cond.icon}</div>
                      <p style={{ fontSize: 11, color: cond.color, fontFamily: "Space Mono,monospace" }}>{cond.label}</p>
                      <div style={{ marginTop: 10 }}>
                        <span style={{ color: "#ffd07f", fontFamily: "Space Mono,monospace", fontSize: 13 }}>{fmt(day.high, unit)}</span>
                        <span style={{ color: "#2a3a5a", margin: "0 4px" }}>/</span>
                        <span style={{ color: "#4a6080", fontFamily: "Space Mono,monospace", fontSize: 13 }}>{fmt(day.low, unit)}</span>
                      </div>
                      <p style={{ color: "#3a5070", fontSize: 11, marginTop: 6 }}>
                        ☁ <span style={{ fontFamily: "Space Mono,monospace" }}>{Math.min(Math.round(day.avgCloud * 11), 100)}%</span>
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        )}

        <footer style={{ textAlign: "center", padding: "24px 0 8px", color: "#1e2d4a", fontSize: 10, fontFamily: "Space Mono,monospace" }}>
          Data: 7Timer! · Moon & Twilight: SunCalc · Geocoding: OpenStreetMap
        </footer>
      </div>
    </div>
  );
}

// ── Global CSS (all responsive breakpoints live here) ────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Outfit:wght@300;400;600;700&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { overflow-x: hidden; }

  /* ── Animations ── */
  @keyframes twinkle  { from { opacity: 0.15; } to { opacity: 0.9; } }
  @keyframes fadeUp   { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes spin     { to   { transform: rotate(360deg); } }

  /* ── Layout ── */
  .container {
    max-width: 1400px;
    width: 100%;
    margin: 0 auto;
    padding: 20px 40px 0;
    position: relative;
    z-index: 1;
  }

  /* ── Header ── */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 24px;
    flex-wrap: wrap;
  }
  .header-brand { flex-shrink: 0; }
  .header-controls {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    flex: 1;
    min-width: 0;
    max-width: 420px;
  }
  .title       { font-family: "Space Mono", monospace; font-size: clamp(20px, 5vw, 30px); font-weight: 700; letter-spacing: 2px; color: #e8f0ff; }
  .subtitle    { color: #2a4060; font-size: 11px; letter-spacing: 4px; text-transform: uppercase; margin-top: 4px; }
  .location-label { color: #4a90ff; font-size: 12px; margin-top: 6px; font-family: "Space Mono", monospace; letter-spacing: 1px; word-break: break-word; }
  .unit-toggle {
    background: rgba(74,144,255,0.12); border: 1px solid rgba(74,144,255,0.35);
    border-radius: 8px; color: #4a90ff; padding: 9px 14px;
    cursor: pointer; font-family: "Space Mono", monospace; font-size: 13px;
    font-weight: 700; white-space: nowrap; flex-shrink: 0;
  }
  .unit-toggle:hover { background: rgba(74,144,255,0.22); }

  /* ── Cards ── */
  .card {
    background: rgba(255,255,255,0.025);
    border: 1px solid rgba(100,140,255,0.12);
    border-radius: 16px;
    padding: 18px;
    backdrop-filter: blur(12px);
    transition: border-color 0.2s;
  }
  .card:hover { border-color: rgba(100,140,255,0.28); }
  .card-label {
    font-family: "Space Mono", monospace;
    font-size: 10px; letter-spacing: 3px;
    text-transform: uppercase; color: #2a4060;
    margin-bottom: 4px;
  }

  /* ── Top info grid: desktop = 3 cols, tablet = 2 cols, mobile = 1 col ── */
  .top-grid {
    display: grid;
    grid-template-columns: 1fr 200px 200px;
    gap: 14px;
    margin-bottom: 18px;
    align-items: start;
  }
  .conditions-card { grid-column: 1; }
  .moon-card       { grid-column: 2; }
  .twilight-card   { grid-column: 3; }

  /* ── Metrics inside conditions card ── */
  .metrics-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px 20px;
    margin-top: 16px;
  }

  /* ── 7-day grid ── */
  .day-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 10px;
    margin-top: 14px;
  }
  .day-card {
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(100,140,255,0.08);
    border-radius: 12px;
    padding: 12px 8px;
    text-align: center;
    transition: all 0.2s;
  }
  .day-card:hover { background: rgba(100,140,255,0.07); transform: translateY(-2px); border-color: rgba(100,140,255,0.2); }

  /* ── Dropdown ── */
  .dropdown-item:hover { background: rgba(74,144,255,0.1); }

  /* ── Tablet: ≤ 768px ── */
  @media (max-width: 768px) {
    .top-grid {
      grid-template-columns: 1fr 1fr;
    }
    .conditions-card {
      grid-column: 1 / -1; /* full width */
    }
    .moon-card     { grid-column: 1; }
    .twilight-card { grid-column: 2; }

    .day-grid {
      grid-template-columns: repeat(4, 1fr);
    }

    .header-controls {
      max-width: 100%;
    }
  }

  /* ── Mobile: ≤ 480px ── */
  @media (max-width: 480px) {
    .container { padding: 14px 12px 0; }

    .header {
      flex-direction: column;
      gap: 14px;
    }
    .header-controls {
      width: 100%;
      max-width: 100%;
    }

    .top-grid {
      grid-template-columns: 1fr 1fr;
    }
    .conditions-card {
      grid-column: 1 / -1;
    }
    .moon-card     { grid-column: 1; }
    .twilight-card { grid-column: 2; }

    .metrics-grid {
      grid-template-columns: 1fr 1fr;
      gap: 10px 14px;
    }

    .day-grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .title { font-size: 22px; }
  }

  /* ── Very small: ≤ 360px ── */
  @media (max-width: 360px) {
    .top-grid {
      grid-template-columns: 1fr 1fr;
    }
    .conditions-card {
      grid-column: 1 / -1;
    }
    .moon-card     { grid-column: 1; }
    .twilight-card { grid-column: 2; }

    .day-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
`;
