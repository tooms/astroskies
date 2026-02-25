export default async function handler(req, res) {
  const { lat, lon, product } = req.query;
  const url = `https://www.7timer.info/bin/api.pl?lat=${lat}&lon=${lon}&product=${product}&output=json`;
  const upstream = await fetch(url);
  const data = await upstream.json();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json(data);
}