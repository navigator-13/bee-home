import * as THREE from 'three';
const TAU=Math.PI*2, rad=THREE.MathUtils.degToRad;
export function animateRig(rig,time,state){
  const cfg=rig.config.animation, cycle=time/state.cycleDuration;
  // The bee is pinned to the crown of the globe. Motion stays inside the rig;
  // the root never bobs, slides, or changes its screen position.
  rig.root.position.set(0,0,0);
  rig.root.rotation.z=0;
  for(const leg of rig.config.legs){
    const p=(cycle+leg.phase)%1, swing=p>.58, wave=Math.sin(p*TAU), lift=swing?Math.sin(((p-.58)/.42)*Math.PI):0;
    const upper=rig.parts.get(leg.upperPartId), lower=rig.parts.get(leg.lowerPartId);
    if(upper){ upper.rotation.z=upper.userData.baseRotation+rad(state.legAmplitude)*(wave*.72-lift*.42); upper.position.y=upper.userData.baseY+lift*cfg.footLift; }
    if(lower) lower.rotation.z=lower.userData.baseRotation+rad(16)*(wave*.32+lift*.68);
    const target=rig.footTargets.get(leg.id); if(target){ target.visible=state.hiddenLegDebug || leg.visible; target.position.y=lift*cfg.footLift; }
  }
  // The photographic body, face, wings, mouthparts, and antennae are static.
  // Only the leg hierarchy is animated.
}
