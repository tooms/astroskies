export default async function handler(req, res) {
  const { q, lat, lon, reverse } = req.query;

  try {
    let url;

    if (reverse === "1" && lat && lon) {
      // Reverse geocode: coords → place name
      url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`;
    } else if (q) {
      // Forward geocode: place name → coords
      url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5`;
    } else {
      return res.status(400).json({ error: "Provide either q (search) or lat+lon+reverse=1" });
    }

    const upstream = await fetch(url, {
      headers: {
        // Nominatim requires a valid User-Agent identifying your app
        "User-Agent": "AstroSkies/1.0 (https://astroskies.vercel.app)",
        "Accept-Language": "en",
      },
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: "Geocoding request failed" });
    }

    const data = await upstream.json();
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=86400"); // cache 24hrs — place names rarely change
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: "Geocoding proxy failed" });
  }
}
