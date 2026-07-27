import * as THREE from 'three';
import {createGlobe} from './createGlobe.js';
import {BeeRig} from './BeeRig.js';
import {animateRig} from './animation.js';

async function boot(){
  const canvas=document.querySelector('#stage'),viewer=document.querySelector('#viewer');
  document.documentElement.classList.toggle('controls-hidden',new URLSearchParams(location.search).get('controls')==='0');
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  const scene=new THREE.Scene();
  const camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,20);camera.position.set(0,.16,5);camera.lookAt(0,.16,0);

  // Outer Z rotation makes the world roll like a wheel. The inner orientation
  // brings Europe/Africa to the front without changing that screen-space axis.
  const globeSpin=new THREE.Group(),globeOrientation=new THREE.Group();scene.add(globeSpin);globeSpin.add(globeOrientation);
  const globe=createGlobe();globe.group.scale.setScalar(.82);globeOrientation.rotation.y=THREE.MathUtils.degToRad(-105);globeOrientation.add(globe.group);

  const beeAnchor=new THREE.Group();beeAnchor.name='beeAnchorGroup';beeAnchor.position.set(-.015,.91,.12);scene.add(beeAnchor);
  const bee=new BeeRig();await bee.load();beeAnchor.add(bee.group);
  const state={hoverPaused:false,cycleDuration:1.25,bob:0,legAmplitude:9,hiddenLegDebug:false,pivotDebug:false};
  const globeSize=document.querySelector('#globe-size'),beeSize=document.querySelector('#bee-size'),globeValue=document.querySelector('#globe-value'),beeValue=document.querySelector('#bee-value');
  const compact=matchMedia('(max-width: 700px)').matches;
  globeSize.value=compact ? .25 : .31;
  beeSize.value=compact ? .32 : .40;
  // Pin the readable foot silhouette—not sub-pixel hairs—to the crown for
  // every scale combination. This perceptual contact remains stable even at
  // the smallest globe / largest bee extreme.
  const setLayout=()=>{const globeScale=Number(globeSize.value),beeScale=Number(beeSize.value);globe.group.scale.setScalar(globeScale);bee.group.scale.setScalar(beeScale);globeSpin.position.y=0;beeAnchor.position.y=globeScale+.10*beeScale;globeValue.textContent=`${Math.round(globeScale*100)}%`;beeValue.textContent=`${Math.round(beeScale*100)}%`};
  globeSize.addEventListener('input',setLayout);beeSize.addEventListener('input',setLayout);setLayout();

  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),beeMeshes=[];bee.group.traverse(o=>{if(o.isMesh&&!bee.debug.children.includes(o))beeMeshes.push(o)});
  canvas.addEventListener('pointermove',(event)=>{const rect=canvas.getBoundingClientRect();pointer.set(((event.clientX-rect.left)/rect.width)*2-1,-((event.clientY-rect.top)/rect.height)*2+1);raycaster.setFromCamera(pointer,camera);state.hoverPaused=raycaster.intersectObjects([globe.sphere,...beeMeshes],false).length>0;viewer.classList.toggle('paused',state.hoverPaused)});
  canvas.addEventListener('pointerleave',()=>{state.hoverPaused=false;viewer.classList.remove('paused')});
  addEventListener('keydown',event=>{if(event.key.toLowerCase()==='d'){state.pivotDebug=!state.pivotDebug;bee.setDebug(state.pivotDebug)}});

  const resize=()=>{const rect=viewer.getBoundingClientRect(),height=2.5,width=height*(rect.width/rect.height);camera.left=-width/2;camera.right=width/2;camera.top=height/2+.16;camera.bottom=-height/2+.16;camera.updateProjectionMatrix();renderer.setSize(rect.width,rect.height,false)};new ResizeObserver(resize).observe(viewer);resize();document.querySelector('#status').remove();
  let last=performance.now(),sim=0;
  function frame(now){requestAnimationFrame(frame);const dt=Math.min((now-last)/1000,.05);last=now;if(!state.hoverPaused){sim+=dt;globeSpin.rotation.z-=dt*.13;animateRig(bee,sim,state)}beeAnchor.quaternion.copy(camera.quaternion);renderer.render(scene,camera)}requestAnimationFrame(frame);
}
boot().catch(error=>{console.error(error);document.querySelector('#status').textContent='Unable to load the bee and world';});
