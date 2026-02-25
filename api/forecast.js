export default async function handler(req, res) {
  const { lat, lon, product } = req.query;

  if (!lat || !lon || !product) {
    return res.status(400).json({ error: "Missing lat, lon, or product parameter" });
  }

  try {
    const url = `https://www.7timer.info/bin/api.pl?lat=${lat}&lon=${lon}&product=${product}&output=json`;
    const upstream = await fetch(url);

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: "Upstream forecast request failed" });
    }

    const data = await upstream.json();
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=1800"); // cache 30 mins on Vercel edge
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch forecast" });
  }
}
