import achilleaStemRgb from '../../docs/assets/pressed/achillea-millefolium-pressed-stem-rgb.png';
import achilleaStemUv from '../../docs/assets/pressed/achillea-millefolium-pressed-stem-uv.png';
import achilleaHeadRgb from '../../docs/assets/pressed/achillea-millefolium-pressed-head-rgb.png';
import achilleaHeadUv from '../../docs/assets/pressed/achillea-millefolium-pressed-head-uv.png';
import centaureaStemRgb from '../../docs/assets/pressed/centaurea-cyanus-pressed-stem-rgb.png';
import centaureaStemUv from '../../docs/assets/pressed/centaurea-cyanus-pressed-stem-uv.png';
import centaureaHeadRgb from '../../docs/assets/pressed/centaurea-cyanus-pressed-head-rgb.png';
import centaureaHeadUv from '../../docs/assets/pressed/centaurea-cyanus-pressed-head-uv.png';
import echiumStemRgb from '../../docs/assets/pressed/echium-vulgare-pressed-stem-rgb.png';
import echiumStemUv from '../../docs/assets/pressed/echium-vulgare-pressed-stem-uv.png';
import echiumHeadRgb from '../../docs/assets/pressed/echium-vulgare-pressed-head-rgb.png';
import echiumHeadUv from '../../docs/assets/pressed/echium-vulgare-pressed-head-uv.png';
import lotusStemRgb from '../../docs/assets/pressed/lotus-corniculatus-pressed-stem-rgb.png';
import lotusStemUv from '../../docs/assets/pressed/lotus-corniculatus-pressed-stem-uv.png';
import lotusHeadRgb from '../../docs/assets/pressed/lotus-corniculatus-pressed-head-rgb.png';
import lotusHeadUv from '../../docs/assets/pressed/lotus-corniculatus-pressed-head-uv.png';
import papaverStemRgb from '../../docs/assets/pressed/papaver-rhoeas-pressed-stem-rgb.png';
import papaverStemUv from '../../docs/assets/pressed/papaver-rhoeas-pressed-stem-uv.png';
import papaverHeadRgb from '../../docs/assets/pressed/papaver-rhoeas-pressed-head-rgb.png';
import papaverHeadUv from '../../docs/assets/pressed/papaver-rhoeas-pressed-head-uv.png';
import echinaceaStemRgb from '../../docs/assets/pressed/echinacea-purpurea-pressed-stem-rgb.png';
import echinaceaStemUv from '../../docs/assets/pressed/echinacea-purpurea-pressed-stem-uv.png';
import echinaceaHeadRgb from '../../docs/assets/pressed/echinacea-purpurea-pressed-head-rgb.png';
import echinaceaHeadUv from '../../docs/assets/pressed/echinacea-purpurea-pressed-head-uv.png';
import monardaStemRgb from '../../docs/assets/pressed/monarda-fistulosa-pressed-stem-rgb.png';
import monardaStemUv from '../../docs/assets/pressed/monarda-fistulosa-pressed-stem-uv.png';
import monardaHeadRgb from '../../docs/assets/pressed/monarda-fistulosa-pressed-head-rgb.png';
import monardaHeadUv from '../../docs/assets/pressed/monarda-fistulosa-pressed-head-uv.png';
import asterStemRgb from '../../docs/assets/pressed/symphyotrichum-novae-angliae-pressed-stem-rgb.png';
import asterStemUv from '../../docs/assets/pressed/symphyotrichum-novae-angliae-pressed-stem-uv.png';
import asterHeadRgb from '../../docs/assets/pressed/symphyotrichum-novae-angliae-pressed-head-rgb.png';
import asterHeadUv from '../../docs/assets/pressed/symphyotrichum-novae-angliae-pressed-head-uv.png';
import ziziaStemRgb from '../../docs/assets/pressed/zizia-aurea-pressed-stem-rgb.png';
import ziziaStemUv from '../../docs/assets/pressed/zizia-aurea-pressed-stem-uv.png';
import ziziaHeadRgb from '../../docs/assets/pressed/zizia-aurea-pressed-head-rgb.png';
import ziziaHeadUv from '../../docs/assets/pressed/zizia-aurea-pressed-head-uv.png';
import grindeliaStemRgb from '../../docs/assets/pressed/grindelia-camporum-pressed-stem-rgb.png';
import grindeliaStemUv from '../../docs/assets/pressed/grindelia-camporum-pressed-stem-uv.png';
import grindeliaHeadRgb from '../../docs/assets/pressed/grindelia-camporum-pressed-head-rgb.png';
import grindeliaHeadUv from '../../docs/assets/pressed/grindelia-camporum-pressed-head-uv.png';
import sceneGarden from '../../docs/assets/scenes/sited-garden.png';
import sceneWall from '../../docs/assets/scenes/sited-wall.png';
import sceneBalcony from '../../docs/assets/scenes/sited-balcony.png';
import beePortrait from '../../docs/assets/bees/osmia-bicornis.png';

const flowers = [
  { region: 'europe', common: 'Yarrow', latin: 'Achillea millefolium', months: [5, 6, 7, 8, 9], stem: [achilleaStemRgb, achilleaStemUv], head: [achilleaHeadRgb, achilleaHeadUv] },
  { region: 'europe', common: 'Cornflower', latin: 'Centaurea cyanus', months: [5, 6, 7, 8], stem: [centaureaStemRgb, centaureaStemUv], head: [centaureaHeadRgb, centaureaHeadUv] },
  { region: 'europe', common: "Viper's bugloss", latin: 'Echium vulgare', months: [5, 6, 7, 8, 9], stem: [echiumStemRgb, echiumStemUv], head: [echiumHeadRgb, echiumHeadUv] },
  { region: 'europe', common: "Bird's-foot trefoil", latin: 'Lotus corniculatus', months: [5, 6, 7, 8, 9], stem: [lotusStemRgb, lotusStemUv], head: [lotusHeadRgb, lotusHeadUv] },
  { region: 'europe', common: 'Common poppy', latin: 'Papaver rhoeas', months: [5, 6, 7, 8], stem: [papaverStemRgb, papaverStemUv], head: [papaverHeadRgb, papaverHeadUv] },
  { region: 'north-america', common: 'Purple coneflower', latin: 'Echinacea purpurea', months: [6, 7, 8, 9], stem: [echinaceaStemRgb, echinaceaStemUv], head: [echinaceaHeadRgb, echinaceaHeadUv] },
  { region: 'north-america', common: 'Wild bergamot', latin: 'Monarda fistulosa', months: [6, 7, 8, 9], stem: [monardaStemRgb, monardaStemUv], head: [monardaHeadRgb, monardaHeadUv] },
  { region: 'north-america', common: 'New England aster', latin: 'Symphyotrichum novae-angliae', months: [8, 9, 10], stem: [asterStemRgb, asterStemUv], head: [asterHeadRgb, asterHeadUv] },
  { region: 'north-america', common: 'Golden Alexander', latin: 'Zizia aurea', months: [4, 5, 6], stem: [ziziaStemRgb, ziziaStemUv], head: [ziziaHeadRgb, ziziaHeadUv] },
  { region: 'north-america', common: 'Great Valley gumplant', latin: 'Grindelia camporum', months: [6, 7, 8, 9, 10], stem: [grindeliaStemRgb, grindeliaStemUv], head: [grindeliaHeadRgb, grindeliaHeadUv] },
];

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const body = document.body;
const regionSelect = document.getElementById('regionSelect');
const fieldSpecimens = document.getElementById('fieldSpecimens');
const flightFlowers = document.getElementById('flightFlowers');
const flightSeasonRows = document.getElementById('flightSeasonRows');
const beeView = document.getElementById('beeView');
let beeMode = false;

function bindImage(img, rgb, uv) {
  img.dataset.rgb = rgb;
  img.dataset.uv = uv;
  img.src = beeMode ? uv : rgb;
}

function visibleFlowers() {
  return flowers.filter((flower) => flower.region === regionSelect.value);
}

function renderFlowers() {
  const selected = visibleFlowers();
  fieldSpecimens.textContent = '';
  flightFlowers.textContent = '';
  flightSeasonRows.textContent = '';

  selected.forEach((flower, index) => {
    const article = document.createElement('article');
    article.className = 'specimen reveal';
    article.style.setProperty('--i', index);
    const image = document.createElement('img');
    image.alt = `${flower.common}, pressed flower specimen`;
    bindImage(image, flower.stem[0], flower.stem[1]);
    article.append(image);
    article.insertAdjacentHTML('beforeend', `<div class="specimen__caption"><p>${flower.common}</p><i>${flower.latin}</i><span>${monthNames[flower.months[0] - 1]}–${monthNames[flower.months.at(-1) - 1]}</span></div>`);
    fieldSpecimens.append(article);

    const orbitFlower = document.createElement('figure');
    orbitFlower.className = `flight-flower flight-flower--${index + 1}`;
    const orbitImage = document.createElement('img');
    orbitImage.alt = flower.common;
    bindImage(orbitImage, flower.head[0], flower.head[1]);
    orbitFlower.append(orbitImage);
    orbitFlower.insertAdjacentHTML('beforeend', `<figcaption>${flower.common}</figcaption>`);
    flightFlowers.append(orbitFlower);

    const row = document.createElement('div');
    row.className = 'season-row';
    row.innerHTML = `<div><strong>${flower.common}</strong><i>${flower.latin}</i></div><div class="season-row__line"><span></span></div>`;
    const start = Math.max(0, flower.months[0] - 3);
    const end = Math.min(8, flower.months.at(-1) - 2);
    row.querySelector('span').style.setProperty('--start', start);
    row.querySelector('span').style.setProperty('--span', end - start);
    flightSeasonRows.append(row);
  });

  observeReveals();
}

function setBeeMode(next) {
  beeMode = next;
  document.documentElement.dataset.beeView = beeMode ? 'bee' : 'human';
  beeView.setAttribute('aria-pressed', String(beeMode));
  document.getElementById('beeViewState').textContent = beeMode ? 'Return to daylight' : 'See as a bee';
  for (const image of document.querySelectorAll('img[data-rgb]')) {
    image.src = beeMode ? image.dataset.uv : image.dataset.rgb;
  }
}

function setVision(vision) {
  body.dataset.siteVision = vision;
  for (const button of document.querySelectorAll('[data-choose-vision]')) {
    button.setAttribute('aria-pressed', String(button.dataset.chooseVision === vision));
  }
  const url = new URL(location.href);
  url.searchParams.set('vision', vision);
  history.replaceState({}, '', url);
  document.getElementById('flowersNav').href = vision === 'flight' ? '#flowers-flight' : '#flowers';
  document.getElementById('placeNav').href = vision === 'flight' ? '#place-flight' : '#place';
  document.querySelector('.site-header .wordmark').href = vision === 'flight' ? '#flight-top' : '#top';
  scrollTo({ top: 0, behavior: 'auto' });
}

let revealObserver;
function observeReveals() {
  if (!revealObserver) {
    revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) entry.target.classList.add('is-visible');
      });
    }, { threshold: 0.12 });
  }
  document.querySelectorAll('.reveal:not([data-observed])').forEach((element) => {
    element.dataset.observed = 'true';
    revealObserver.observe(element);
  });
}

document.getElementById('fieldHero').src = sceneGarden;
document.getElementById('sceneGarden').src = sceneGarden;
document.getElementById('sceneWall').src = sceneWall;
document.getElementById('sceneBalcony').src = sceneBalcony;
document.getElementById('flightScene').src = sceneWall;
document.getElementById('beeViewImage').src = beePortrait;

beeView.addEventListener('click', () => setBeeMode(!beeMode));
regionSelect.addEventListener('change', renderFlowers);
document.querySelectorAll('[data-choose-vision]').forEach((button) => {
  button.addEventListener('click', () => setVision(button.dataset.chooseVision));
});

const orbit = document.getElementById('flightOrbit');
orbit.addEventListener('pointermove', (event) => {
  const rect = orbit.getBoundingClientRect();
  orbit.style.setProperty('--mx', `${((event.clientX - rect.left) / rect.width - 0.5) * 18}px`);
  orbit.style.setProperty('--my', `${((event.clientY - rect.top) / rect.height - 0.5) * 18}px`);
});
orbit.addEventListener('pointerleave', () => {
  orbit.style.setProperty('--mx', '0px');
  orbit.style.setProperty('--my', '0px');
});

const requestedVision = new URLSearchParams(location.search).get('vision');
setVision(requestedVision === 'flight' ? 'flight' : 'field');
renderFlowers();
setBeeMode(false);
observeReveals();
