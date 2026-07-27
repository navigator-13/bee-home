import * as THREE from 'three';
import {rigConfig} from './rigConfig.js';

export class BeeRig {
  constructor(){ this.config=rigConfig; this.group=new THREE.Group(); this.group.name='beeRigGroup'; this.root=new THREE.Group(); this.group.add(this.root); this.parts=new Map([['root',this.root]]); this.footTargets=new Map(); this.debug=new THREE.Group(); this.group.add(this.debug); }
  async load(){
    const loader=new THREE.TextureLoader(), jobs=this.config.parts.map(async p=>{
      const textureUrl=window.__BEE_GLOBE_ASSETS__?.[p.texturePath]||`/assets/bee/${p.texturePath}`;
      const texture=await loader.loadAsync(textureUrl); texture.colorSpace=THREE.SRGBColorSpace;
      const w=this.config.sourceWidth*this.config.scale, h=this.config.sourceHeight*this.config.scale;
      const geometry=new THREE.PlaneGeometry(w,h); geometry.translate(w*(.5-p.pivot.x),h*(p.pivot.y-.5),0);
      const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:texture,transparent:true,depthTest:false,depthWrite:false,side:THREE.DoubleSide}));
      mesh.renderOrder=100+p.depth*1000;
      const parent=this.config.parts.find(candidate=>candidate.id===p.parentId);
      const parentPivot=parent?.pivot||{x:.51,y:.49};
      const node=new THREE.Group(); node.name=p.id; node.position.set((p.pivot.x-parentPivot.x)*w,(parentPivot.y-p.pivot.y)*h,p.depth-(parent?.depth||0)); node.rotation.z=THREE.MathUtils.degToRad(p.initialRotation||0); node.userData.baseY=node.position.y; node.userData.baseRotation=node.rotation.z; node.add(mesh); this.parts.set(p.id,node); return [p,node];
    });
    const made=await Promise.all(jobs); for(const [p,node] of made) (this.parts.get(p.parentId)||this.root).add(node);
    this.makeDebug(); return this;
  }
  makeDebug(){
    const dotGeo=new THREE.CircleGeometry(.008,16), dotMat=new THREE.MeshBasicMaterial({color:0xff3b30,depthTest:false});
    for(const p of this.config.parts){ const dot=new THREE.Mesh(dotGeo,dotMat); dot.position.copy(this.parts.get(p.id).position); dot.position.z=.06; this.debug.add(dot); }
    const colors={near:0x007aff,far:0xff9500};
    this.config.legs.forEach((leg,i)=>{ const t=new THREE.Mesh(new THREE.RingGeometry(.008,.013,18),new THREE.MeshBasicMaterial({color:colors[leg.side],side:THREE.DoubleSide,depthTest:false})); t.position.set((i-2.5)*.075,-.33,.065); this.footTargets.set(leg.id,t); this.debug.add(t); });
    this.debug.visible=false;
  }
  setDebug(show){ this.debug.visible=show; }
}
