import {writeFile, rename, mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

// Ziel: DATA_DIR (z. B. /var/lib/hydrantenkarte), sonst public/data im Projekt
const target = process.env.DATA_DIR ? pathToFileURL(process.env.DATA_DIR.replace(/\/?$/, '/')) : new URL('../public/data/', import.meta.url);

const WFS = 'https://data.wien.gv.at/daten/geo?service=WFS&request=GetFeature&version=1.1.0&srsName=EPSG:4326&outputFormat=json&typeName=';

async function download(layer) {
  const response = await fetch(WFS + layer, {signal: AbortSignal.timeout(60000)});
  if (!response.ok) throw Error(`Download ${layer} fehlgeschlagen: ${response.status}`);
  return response.json();
}
async function save(name, data) {
  await mkdir(target, {recursive: true});
  const file = new URL(name, target);
  const tmp = new URL(file + '.tmp');
  await writeFile(tmp, JSON.stringify(data));
  await rename(tmp, file);
}

// Douglas-Peucker in Grad; Toleranz 0.00008° ≈ 9 m
export function simplify(points, tolerance = 0.00008) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const lngScale = Math.cos(48.2 * Math.PI / 180) ** 2;
  while (stack.length) {
    const [a, b] = stack.pop();
    const [x1, y1] = points[a], [x2, y2] = points[b];
    const dx = x2 - x1, dy = y2 - y1, len = dx * dx + dy * dy;
    let max = 0, index = -1;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = points[i];
      const u = len ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len)) : 0;
      const ex = x1 + u * dx - x, ey = y1 + u * dy - y;
      const d = ex * ex * lngScale + ey * ey;
      if (d > max) { max = d; index = i; }
    }
    if (max > tolerance * tolerance) { keep[index] = 1; stack.push([a, index], [index, b]); }
  }
  return points.filter((_, i) => keep[i]).map(([x, y]) => [Number(x.toFixed(5)), Number(y.toFixed(5))]);
}

const hydrants = await download('ogdwien:HYDRANTOGD');
if (hydrants.type !== 'FeatureCollection' || hydrants.features?.some(f => !Number.isInteger(f.properties?.OBJECTID)) || hydrants.features?.length < 10000 || Number(hydrants.totalFeatures) !== hydrants.features.length ||
  hydrants.features.some(f => f.geometry?.type !== 'Point' || f.geometry.coordinates[0] < 16 || f.geometry.coordinates[0] > 17 || f.geometry.coordinates[1] < 48 || f.geometry.coordinates[1] > 49))
  throw Error('Hydrantendatensatz unvollständig oder unerwartet. Vorherige Daten bleiben erhalten.');

const raw = await download('ogdwien:BEZIRKSGRENZEOGD');
if (raw.type !== 'FeatureCollection' || raw.features?.length !== 23 || raw.features.some(f => !['Polygon', 'MultiPolygon'].includes(f.geometry?.type) || !Number.isInteger(f.properties?.BEZNR) || !f.properties?.NAMEK))
  throw Error('Bezirksgrenzen unvollständig oder unerwartet. Vorherige Daten bleiben erhalten.');
const districts = {
  type: 'FeatureCollection',
  source: 'Stadt Wien – data.wien.gv.at, BEZIRKSGRENZEOGD, CC BY 4.0 (vereinfacht ~10 m)',
  timeStamp: raw.timeStamp || new Date().toISOString(),
  features: raw.features.map(f => ({
    type: 'Feature',
    properties: {nr: f.properties.BEZNR, name: f.properties.NAMEK},
    geometry: f.geometry.type === 'Polygon'
      ? {type: 'Polygon', coordinates: f.geometry.coordinates.map(r => simplify(r))}
      : {type: 'MultiPolygon', coordinates: f.geometry.coordinates.map(p => p.map(r => simplify(r)))}
  })).sort((a, b) => a.properties.nr - b.properties.nr)
};

// Kompaktes Format: [Objekt-ID, Breite, Länge] je Hydrant, ~85 % kleiner als GeoJSON
await save('hydrants.json', {
  source: 'Stadt Wien – data.wien.gv.at, HYDRANTOGD, CC BY 4.0',
  timeStamp: hydrants.timeStamp || new Date().toISOString(),
  fields: ['id', 'lat', 'lng'],
  data: hydrants.features.map(f => [f.properties.OBJECTID, Number(f.geometry.coordinates[1].toFixed(6)), Number(f.geometry.coordinates[0].toFixed(6))])
});
await save('districts.geojson', districts);
console.log(`${hydrants.features.length} Hydranten und ${districts.features.length} Bezirke aktualisiert (${target.pathname}).`);

