import * as THREE from 'three';
import {feature} from 'topojson-client';
import world from 'world-atlas/countries-110m.json';

export function point(lon,lat,radius=1.006){
  const phi=(90-lat)*Math.PI/180,theta=(lon+180)*Math.PI/180;
  return new THREE.Vector3(-radius*Math.sin(phi)*Math.cos(theta),radius*Math.cos(phi),radius*Math.sin(phi)*Math.sin(theta));
}

function addLine(points,parent,opacity=.7){
  if(points.length<2)return;
  parent.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0x1d1d1a,transparent:true,opacity})));
}

export function createGlobe(){
  const group=new THREE.Group();group.name='globeGroup';
  const sphere=new THREE.Mesh(new THREE.SphereGeometry(1,96,64),new THREE.MeshBasicMaterial({color:0xf4f3ef,transparent:true,opacity:.98}));group.add(sphere);
  const grid=new THREE.Group(),coastlines=new THREE.Group();group.add(grid,coastlines);
  for(let lat=-75;lat<=75;lat+=15){const pts=[];for(let lon=-180;lon<=180;lon+=2)pts.push(point(lon,lat));addLine(pts,grid,.42)}
  for(let lon=-180;lon<180;lon+=15){const pts=[];for(let lat=-89;lat<=89;lat+=2)pts.push(point(lon,lat));addLine(pts,grid,.42)}
  const addRing=(coords)=>{let segment=[];for(let i=0;i<coords.length;i++){const [lon,lat]=coords[i];if(i>0&&Math.abs(lon-coords[i-1][0])>180){addLine(segment,coastlines,.95);segment=[]}segment.push(point(lon,lat,1.012))}addLine(segment,coastlines,.95)};
  const countries=feature(world,world.objects.countries);countries.features.forEach(({geometry:g})=>{if(!g)return;if(g.type==='Polygon')g.coordinates.forEach(addRing);if(g.type==='MultiPolygon')g.coordinates.forEach(poly=>poly.forEach(addRing))});
  return {group,grid,coastlines,sphere};
}

export const presets={
  britain:{lon:-4,lat:55,dist:4.15},nordics:{lon:18,lat:63,dist:4.2},central:{lon:12,lat:50,dist:4.1},mediterranean:{lon:15,lat:38,dist:4.15},naeast:{lon:-75,lat:40,dist:4.15},nawest:{lon:-122,lat:39,dist:4.15},world:{lon:-20,lat:25,dist:4.45},
};
