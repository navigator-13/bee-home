# Research — bee vision and the flower plates

Research completed 26 July 2026 for the image work described in
`docs/ASSET-BRIEF.md`. This document is the gate before plate generation. It
distinguishes measured evidence from visual convention and deliberately leaves
species unpatterned where I could not find species-level evidence.

## 0.1 Three different kinds of “UV flower photography”

They are not interchangeable:

1. **Reflected-ultraviolet photography** records ultraviolet radiation reflected
   by the subject while blocking visible light. It is normally presented in
   greyscale: light areas reflect more of the recorded UV band; dark areas absorb
   more. It is evidence for spatial UV reflectance, but by itself it is not a
   picture of bee colour perception.
2. **UV-induced visible fluorescence (UVIVF)** illuminates a subject with UV and
   records the longer-wavelength visible light emitted by fluorescent material.
   It produces the familiar glowing-on-black photographs. Fluorescence emission
   is not reflected UV, and UVIVF omits UV reflectance while potentially showing
   red fluorescence outside useful bee sensitivity. It therefore cannot stand
   in for bee vision. A recent review explicitly warns that UVIVF images do not
   show the UV reflection flowers present to bees and that floral fluorescence
   is generally negligible beside reflected daylight
   ([Lunau, 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12477309/)).
3. **Bee-vision simulation / false colour** combines measurements or photographs
   representing the bee's UV, blue and green receptor bands, then assigns those
   three channels to colours a human screen can display. The result is an
   explanatory visualization, not literal access to a bee's subjective colour.

**The plates in this project are type 3: bee-vision false-colour simulations.**
Reflected-UV photographs and spectra may inform their patterns. UVIVF imagery
must not inform their palette or appearance. In particular, there should be no
electric-blue glow on black.

## 0.2 What the bee eye does, and the display convention

The honeybee has three photoreceptor classes, peaking at approximately **344 nm
(UV), 436 nm (blue) and 544 nm (green)**. All three contribute to colour vision;
achromatic/brightness tasks are dominated by the green receptor
([Hempel de Ibarra et al., 2014](https://link.springer.com/article/10.1007/s00359-014-0915-1)).
The exact curves and peaks vary somewhat among bee taxa, but UV–blue–green
trichromacy is the appropriate model for these general “bee view” plates.

Bees therefore see ultraviolet but have no dedicated red receptor. “Bees cannot
see red” is useful shorthand, not a rule that every human-red flower is simply
black. A surface that reflects only long red wavelengths gives little or no
chromatic signal to the three bee receptors and can be difficult to distinguish
from foliage. A human-red flower may nevertheless be conspicuous if it also
reflects UV, blue, or enough shorter-wavelength light to stimulate the green
receptor. Common poppy is an especially important population-dependent example,
described below.

**Bee purple** is the bee-subjective colour produced by jointly stimulating the
short- and long-wavelength ends of the bee range—UV and green—with relatively
less blue stimulation. Behavioural colour-mixing experiments established this
category ([Hempel de Ibarra et al., 2014](https://link.springer.com/article/10.1007/s00359-014-0915-1)).
An ordinary RGB display emits no UV and is designed for human receptors, so it
cannot reproduce bee purple truthfully. It can only label it by convention.

### False-colour convention selected for this project

The plates will use the common bathochromic channel shift:

| Bee receptor/input band | Human display channel |
| --- | --- |
| ultraviolet | blue |
| blue | green |
| green | red |
| human red | discarded |

This is the **UV→B, B→G, G→R** convention described for bee-view false-colour
photography by [Lunau (2025)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12477309/).
Other mappings exist, especially UV→red while retaining blue and green in their
human channels. The selected mapping must therefore be stated in site copy or
metadata; its hues are a legend, not “the colours bees literally see.”

Where only a spatial UV photograph—not full multispectral receptor data—is
available, a plate can honestly preserve the documented UV-light/UV-dark pattern,
but its full false-colour values remain an informed visualization rather than a
quantitative reconstruction. FReD is useful because it stores measured flower
reflectance spectra and can calculate loci in bee colour-space models, but a
single spectrum does not by itself establish a spatial bullseye
([Arnold et al., 2010](https://pmc.ncbi.nlm.nih.gov/articles/PMC3000818/)).

## 0.3 Species evidence and plate decisions

“Pattern not documented” below means I did not find reliable species-level
evidence for a **spatial** UV pattern in the sources reviewed. It does not mean
the flower has no UV response. Spectral measurement of one sampled area and a
spatial reflected-UV image answer different questions. No pattern is inferred
from family, visible colour, popularity with bees, or a related species.

| Species / slug | Evidence found | Plate decision |
| --- | --- | --- |
| *Echium vulgare* — `echium-vulgare` | Petal optical properties and spectra have been measured, including low long-wave backscatter, but the study does not document a spatial UV nectar-guide pattern ([van der Kooi et al., 2016](https://pmc.ncbi.nlm.nih.gov/articles/PMC4874715/)). | **Pattern not documented.** Do not add a bullseye or guide lines. |
| *Centaurea nigra* — `centaurea-nigra` | No species-level reflected-UV image or spatial pattern located. | **Pattern not documented.** |
| *Lotus corniculatus* — `lotus-corniculatus` | Published spectral classification identifies it as a human-yellow flower that absorbs roughly 300–480 nm before rising in the green range ([Chittka et al., 1994](https://citeseerx.ist.psu.edu/document?doi=d1b92fc56923c074f6649c6090f7542a7958c740&repid=rep1&type=pdf)). A photographic demonstration reports the upper portion as UV-reflecting and the lower portion as UV-absorbing ([Jolyon Troscianko, 2020](https://www.jolyon.co.uk/2020/07/garden-flowers-in-bee-vision/)); treat this photographic source as supporting rather than quantitative evidence. | Use a restrained **upper-reflecting/lower-absorbing banner/keel contrast**, not a radial bullseye. Flag as moderate-confidence. |
| *Origanum vulgare* — `origanum-vulgare` | Flower reflectance from 300–700 nm is documented in the literature survey, but no species-specific spatial pattern was located ([Shrestha et al., 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC10962828/)). | **Pattern not documented.** |
| *Achillea millefolium* — `achillea-millefolium` | Matched visible/UV photography reports its bright white inflorescences as almost uniformly dark in reflected UV ([Primack, “Ultraviolet Patterns in Flowers”](https://www.readkong.com/page/ultraviolet-patterns-in-flowers-1779903)). | Render the flower heads **broadly UV-absorbing/dark**, without a bullseye. |
| *Knautia arvensis* — `knautia-arvensis` | Reflectance spectra exist and place it in a bee blue-violet category, but I found no defensible spatial UV pattern ([Chittka et al., 1994](https://citeseerx.ist.psu.edu/document?doi=d1b92fc56923c074f6649c6090f7542a7958c740&repid=rep1&type=pdf)). | **Pattern not documented.** Uniform receptor-based colour only. |
| *Prunella vulgaris* — `prunella-vulgaris` | Searches located UV-response physiology studies, not reflected-UV floral imaging or a spatial pollinator pattern. | **Pattern not documented.** |
| *Salvia pratensis* — `salvia-pratensis` | Published reflectance datasets classify blue and white morphs in bee colour space, but no spatial UV guide was established in the material found ([Heuschen, 2005](https://refubium.fu-berlin.de/bitstream/handle/fub188/6650/03_4_DissCh2.pdf?sequence=4)). | **Pattern not documented.** Keep morph identity consistent; do not invent throat lines. |
| *Papaver rhoeas* — `papaver-rhoeas` | UV reflectance varies geographically. East Mediterranean populations can be almost exclusively red-reflecting/UV-poor, while Central European flowers commonly reflect strongly in UV; North Mediterranean populations include both forms. The difference is associated with flavonol glycosides ([Martínez-Harms et al., 2020](https://pubmed.ncbi.nlm.nih.gov/32708009/); [Dudek et al., 2020](https://www.sciencedirect.com/science/article/pii/S0031942220301242)). This is a whole-petal/population difference, not evidence for a universal bullseye. | Make the provenance explicit. For this European site, use a **Central European, whole-petal UV-reflecting** specimen unless a location-specific alternative is desired. Do not add a bullseye. The duplicate “red-vision case” should compare this with an explicitly labelled East Mediterranean UV-poor variant, not pretend one plate is universal. |
| *Centaurea cyanus* — `centaurea-cyanus` | Visible reflectance/pigment work exists, but no reliable species-level spatial reflected-UV pattern was located. | **Pattern not documented.** |
| *Onobrychis viciifolia* — `onobrychis-viciifolia` | No species-level reflected-UV image or spatial pattern located. | **Pattern not documented.** |
| *Daucus carota* — `daucus-carota` | Field UV photography of carrot umbels found no UV reflectance, apart from occasional tiny nectar pinpricks; test plants confirmed that the camera setup could detect UV reflectance ([Broussard et al., 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7412318/)). | Render the umbel **UV-dark / non-reflecting**. Do not turn its dark central floret into a UV target without further evidence. |
| *Lavandula stoechas* — `lavandula-stoechas` | Studies record UV presence as a floral trait in cultivar comparisons, but the accessible report does not establish one stable species-level spatial pattern ([Erickson et al., 2025](https://pollinationecology.org/index.php/jpe/article/view/813)). | **Pattern not documented.** Do not assume the showy sterile bracts form UV guides. |
| *Salvia rosmarinus* — `salvia-rosmarinus` | No species-level reflected-UV image or spatial pattern located. | **Pattern not documented.** |
| *Thymus vulgaris* — `thymus-vulgaris` | Reflected-UV and simulated bee-view photographs describe a weak pattern with petals fairly UV-bright around 380 nm ([Klaus Schmitt, 2015](https://photographyoftheinvisibleworld.blogspot.com/2015/05/)). | Use **subtle, fairly uniform petal UV reflectance**; no strong bullseye. Moderate-confidence photographic evidence. |
| *Glebionis coronaria* — `glebionis-coronaria` | No species-level reflected-UV image or spatial pattern located. Yellow Asteraceae relatives are not sufficient evidence. | **Pattern not documented.** |
| *Monarda fistulosa* — `monarda-fistulosa` | Large-scale visible-image work documents geographic visible-colour variation, not UV spatial patterning ([McKenzie et al., 2026](https://pubmed.ncbi.nlm.nih.gov/42313785/)). | **Pattern not documented.** |
| *Echinacea purpurea* — `echinacea-purpurea` | Pollinator and nectary studies were located, but not a reliable species-level reflected-UV pattern. Results for *Rudbeckia* or other Asteraceae must not be transferred to *Echinacea*. | **Pattern not documented.** |
| *Symphyotrichum novae-angliae* — `symphyotrichum-novae-angliae` | No species-level reflected-UV image or spatial pattern located. | **Pattern not documented.** |
| *Zizia aurea* — `zizia-aurea` | No species-level reflected-UV image or spatial pattern located. | **Pattern not documented.** |
| *Eschscholzia californica* — `eschscholzia-californica` | Multispectral photography reports the petals as strongly UV-absorbing while anthers and foliage reflect more UV ([Jolyon Troscianko, 2020](https://www.jolyon.co.uk/2020/07/garden-flowers-in-bee-vision/)). Peer-reviewed work confirms spectral measurement of the petals and their unusual “silky” structural reflectivity, although it does not itself claim a nectar-guide pattern ([Wilts et al., 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC6055853/)). | Render **UV-dark petals with contrasting more-reflective anthers**, not a petal bullseye. Moderate-confidence for the spatial contrast. |
| *Phacelia tanacetifolia* — `phacelia-tanacetifolia` | Its value to honeybees and bumblebees is well documented, but visitation does not establish a UV pattern ([Williams & Christian, 1991](https://www.tandfonline.com/doi/abs/10.1080/00218839.1991.11101227)). No species-level reflected-UV pattern was located. | **Pattern not documented.** |
| *Grindelia camporum* — `grindelia-camporum` | No species-level reflected-UV image or spatial pattern located. The plant's resin and visible daisy form do not justify borrowing the common Asteraceae bullseye trope. | **Pattern not documented.** |

## 0.4 Source assessment

- **Bjørn Rørslett's archive:** a valuable reflected-UV photographic reference,
  but photographs must be checked for exact taxon and imaging method. I did not
  locate a stable, citable species page for most taxa in this list during this
  pass. Archive photographs are evidence of reflected UV, not fluorescence and
  not automatically a calibrated bee-view simulation.
- **Klaus Schmitt's work:** includes both reflected-UV photographs and explicit
  simulated bee-view composites. The *Thymus vulgaris* item above states the
  method and is treated as photographic, moderate-confidence evidence rather
  than measured receptor quantum catches.
- **FReD:** a peer-reviewed database of measured reflectance spectra and modeled
  bee colour loci ([Arnold et al., 2010](https://pmc.ncbi.nlm.nih.gov/articles/PMC3000818/)).
  It is strongest for spectral colour and weak for spatial claims when only one
  floral region was measured.
- **Chittka and collaborators:** primary foundation for floral spectra and bee
  colour-space interpretation. The 1994 survey categorizes spectral reflectance
  functions but should not be misread as a spatial UV photograph
  ([Chittka et al., 1994](https://citeseerx.ist.psu.edu/document?doi=d1b92fc56923c074f6649c6090f7542a7958c740&repid=rep1&type=pdf)).
- **Lunau's 2025 review:** the clearest source used here for distinguishing
  reflectance, UVIVF, greyscale UV imagery and false-colour bee-view mappings
  ([full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC12477309/)).

## 0.5 Licensing and image-use declaration

No source photograph was downloaded, traced, composited, copied, or used as an
image input while preparing this research. Sources were used only to establish
scientific and photographic claims. Generated plates must likewise be original
outputs informed by the findings above; third-party imagery must not be pasted,
traced, or composited into them.

## Contradictions and production consequences

The research contradicts any workflow that gives every flower a strong radial
UV bullseye. Only a handful of listed species have usable spatial evidence in
this pass, and the documented signals differ: whole-head UV absorption, weak
uniform reflectance, organ-level contrast, banner/keel contrast, or geographic
whole-petal variation.

Before bulk generation, make one registered RGB/bee-view pair as a trial. The
best scientific stress test is *Papaver rhoeas*, but it must be labelled by
geographic form. The best simpler style test is *Achillea millefolium*, whose
UV-dark result is comparatively clear. Whichever is selected, the RGB and
bee-view plates must retain the same silhouette and scale, and the bee-view
plate should include or ship with the UV→B, B→G, G→R mapping legend.
