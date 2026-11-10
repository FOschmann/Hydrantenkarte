import {writeFile,rename} from 'node:fs/promises';
const url='https://data.wien.gv.at/daten/geo?service=WFS&request=GetFeature&version=1.1.0&typeName=ogdwien:HYDRANTOGD&srsName=EPSG:4326&outputFormat=json';
const response=await fetch(url,{signal:AbortSignal.timeout(60000)});
if(!response.ok)throw Error(`Download fehlgeschlagen: ${response.status}`);
const data=await response.json();
if(data.type!=='FeatureCollection'||data.features?.length<10000||Number(data.totalFeatures)!==data.features.length||data.features.some(f=>f.geometry?.type!=='Point'||f.geometry.coordinates[0]<16||f.geometry.coordinates[0]>17||f.geometry.coordinates[1]<48||f.geometry.coordinates[1]>49))throw Error('Datensatz unvollständig oder unerwartet. Vorherige Daten bleiben erhalten.');
const file=new URL('../public/data/hydrants.geojson',import.meta.url);await writeFile(new URL(file+'.tmp'),JSON.stringify(data));await rename(new URL(file+'.tmp'),file);console.log(`${data.features.length} Hydranten aktualisiert.`);
