# Maritime Environment Safety: Advanced Oil Spill

## Detection through AIS and Remote Sensing
Prof. Senthilnathan S1, Prof. Rajakumar R2, Sanjai A3, Yuvasri S3, Suganya E4, Vasanth D5
1, 3, 4Dept. of Computer Science and Engineering, JNN Institute of Engineering Chennai, India
5Dept. of Artificial Intelligence and Data Science Engineering, JNN Institute of Engineering Chennai, India
2Dept. of Robotics and Automation Engineering, JNN Institute of Engineering, Chennai, India
Abstract: Oil spills constitute one of the most devastating environmental disasters that threaten marine ecosystems, coastal
communities, and wildlife. From identification to intervention, prompt action is necessary to reduce the impact of oil spills.
Traditionally used techniques for detection of oil spills involve direct visual surveillance or simple sampling which continues to
be extremely costly, slow, and unsustainable for operating on a larger scale. In this scenario, AIS data, together with
technologies for satellite remote sensing, are gradually becoming promising tools for detection and monitoring of oil spills in
real time over vast stretches of ocean areas. This paper looks into the feasibility of combining the two types of data, namely vessel
movements tracked by AIS, and satellite datasets consisting of SAR and optical imagery for detecting and assessing oil spills in
marine waters. The strengths and challenges of integrating them as a way of enhancing the efficiency of oil spill detection and
timeliness in the response is highlighted.
**Keywords:** Marine Oil Spill Detection, Deep Learning, Swin Transformer, DeepLabv3+, U-Net, Satellite Imagery, Automatic
Identification System (AIS), Environmental Monitoring, Remote Sensing, Semantic Segmentation.

# I. INTRODUCTION
Oil spills are one of the most devastating types of environmental incidents, leading to long-term harm to marine ecosystems,
wildlife, and coastal economies. These incidents are generally caused by maritime accidents, illegal dumping, or due to accidental
leakages while performing offshore oil drilling. While the aftermath of oil spills has far-reaching ecological damage, including the
loss of habitats, the affected coastal areas, and the toxins that marine species are subjected to, oil spills also have extended economic
impacts on fishing activities, tourism, and the personal livelihoods of coastal-based communities. With
Increasing volumes of oil now transported across seas and oceans, along with the unpredictable nature of maritime incidents, there is
an urgent requirement for new and efficient tools to detect oil spills in the marine environment and lay down a proper mitigation
both in terms PM from pollution, as well as economical compensation for marine life losses. Responding quickly and effectively is
critical for minimizing damage from spills. This can only be achieved via efficient surveillance and monitoring systems. Oil spill
detection has most often been conducted through traditional means such as visual searches made by aircraft or ships, satellite
imagery, and on-site sampling. Thus far, these means have been useful; however, they have a series of setbacks: such cases or
instances can be very costly and time-consuming, apart from a limited scope for continuous overview of wide oceanic areas. For
example, visual searches are resource-intensive and require trained personnel to them, in addition to being dependent on favourable
weather conditions. Altogether, obtaining real-time rapid information for quick mitigation strategies has been an important issue.
For the last few years, however, the advancement in Automatic Identification System (AIS) technology and satellite remote sensing
have opened up a new avenue wherein identification of oil spills may be accomplished in an instantaneous and economic manner.
Both technologies have some complementary benefits, which are leveraged together to augment the oil spill detection system for
more success.

## A. The Key Contributions of SAR in oil Spill Detection
All-weather and Night-time Monitoring: Unlike optical sensors, it ensures continuous surveillance in cloudy and dark conditions.
Large area Coverage: It has the ability to scan huge ocean areas in one single pass, making it real efficient for detecting spills in faroff
regions. Detection of Thin Oil Layers: It has found and ascertained even minute oil slicks, assisting in making an early spill
detection and response. Distinguishing Oil from Water: Oil smoothens surface roughness, appearing as dark patches in SAR images,
helping differentiate it from seawater. Integration with other Sensors: There are SAR data to couple with optical, thermal, and AIbased
models for more efficient accuracy.
Limitations &Challenges: Low-wind areas or natural biogenic films are very likely mistaken for oil spills. Further validation is
required through optical imagery, drones, or in-situ sampling. Overall, SAR is an efficient instrument for oil spill detection
enhancement in marine environmental protection and disaster response

# II. LITERATURE REVIEW
The Automatic Identification System (AIS) is a tracking system adopted for vessels and vessel operations. It facilitates the
automatic exchange of navigational data, in particular, the identification and position of the ship, speed, and course, among other
vital information. Moreover, the AIS was, in concept, originally intended for collision avoidance and other maritime safety
purposes, but has now found much broader applications in marine surveillance. ''VTS'' is called ''Vessel Traffic Services,'' having
made inroads into the collection of this data, and being in turn, monitored by maritime authorities, and eventually made publicly
available through various global databases. These databases contain real-time information about vessel location, route, or speed,
along with organization data that can be analyzed in the search for various types of anomalous activity that might signify a potential
spill event. For example, any deviations from the course by the vessel, unexpected stops, or sudden reductions in speed, in AIS data
may all signal possible involvement of such vessels in an accident or spill. However valuable AIS might be in offering insights into
ship movements and activities, it possesses equally daunting limitations; foremost is the fact that vessels can deliberately switch off
their AIS transponders to avoid detection. It is therefore deemed one with the perilous advantage of keeping the vessel involved in
an oil spill hidden from the eyes of nearest authorities. Another concerning limitation of the AIS with respect to aiding in spill
detection is that it does not provide direct information regarding environmental conditions or sea surface status; consequently,
although it may indicate the presence of a vessel, it is incapable of actually detecting the spill.

## A. Methods for using AIS for Oil Spills Tracking
The AIS (Automatic Identification System) directly helps track oil spills by providing useful vessel movement data, which can then
be analyzed, in order to suggest suspect sources of pollution. When integrated with satellite imagery and environmental modeling,
AIS plays a crucial role in spill detection, investigation, and response. The following methods outline how AIS is used for oil spill
tracking:

### 1) Monitoring Ships and Collecting Data in Real Time
Based on shipboard transponder data, the Automatic Identification System (AIS) provides continuous and real-time broadcast data
on vessel identity, position, speed, heading, and type of cargo. The vessel movement data is thus collected by coastal stations,
satellites, and ship-based receivers. Such monitoring helps authorities observe movements of those vessels with oil sensitive
interests such as shipping channels, offshore oil drilling zones, and marine protected areas.

### 2) Anomaly Detection for Identifying Potential Polluters
Using analysis of the AIS data, different kinds of unusual behaviors of vessels can be tracked to suggest illegal oil discharge.
Automatic notifications may issue for anomalies such as an unplanned sudden speed reduction, irregular deviation of course, or
vessels stopping in prohibited areas. Likewise, vessels that shut off or deliberately would not transmit their AIS signals (AIS
spoofing-like behaviors) while on the high seas may be regarded as high risks, so monitoring is heightened.

### 3) Cross-Referencing AIS with Remote Sensing
Before pollution takes place, once oil pollution is confirmed through satellite observation, aerial survey, or reports from the field,
then the recorded time and location of the spill are cross-checked against the AIS records by authorities to know which vessels were
in the vicinity. Synthetic aperture radar (SAR)-derived images, thermal infrared imagery, and optical satellite imagery will confirm
whether an AIS-traced vessel could be contributing to the pollution or not.

### 4) Historical Analysis of AIS Data for Source Attribution
Archival AIS data affords historical records of vessel movements and thus can provide evidence in determining if indeed a certain
ship was accountable for a prior spill. By tracing the routes of ships to and from ports and identifying transferred cargo information,
authorities could trace oil pollution back to the source. A clear advantage of this technique is when the spill in question is noted after
a certain ship has already left the area.

### 5) Predicting the Movement of Spills by the Integration of AIS and Oceanographic Data
The oceanographic modeling integrated to predict the oil spills' trajectory or drift uses AIS data. According to this scheme, stabbing
for the way of spills and what part of the coast they may strike could be estimated based on the provided wind, current, and wave
data, along with ship traffic monitoring information. Such predictions facilitate fast reaction and containment options in upper cases.
Data tracked by the Automatic Identification System is used as a basis for environmental investigations and in legal proceedings.
When such vessels are suspected to be involved in oil pollution, authorities may inspect such records, examine former behaviors,
and impose fines or penalties when there is evidence of illegal discharge. Therefore, by using evidence from AIS to enforce existing
regulations, authorities are able to deter violations in the future and promote cleaner shipping practices. When aided by AIS data, an
oil spill response can better coordinate by identifying vessels nearby that can assist with cleanup tasks. This enables response teams
to quickly assess which ships are available, including oil recovery vessels or coast guard units, for deploying containment booms,
skimmers, and dispersants to mitigate any environmental damage. In conclusion, AIS plays a critical role in oil spill tracking
through the provision of real-time vessel monitoring, suspicious activity detection, identification of sources of spills, prediction of
oil movement, and backtracking for legality enforcement. Conjoined with remote sensing, environmental modeling, and AI-built
anomaly detection algorithms, AIS improves maritime safety and introduces a strong defense in protecting marine ecosystems
against oil pollution.

## B. Ship Tracking or Vessel Tracking/AIS
The Automatic Identification System is an important system applied in oil spill investigations, since it does not directly detect the oil
itself. Instead, AIS details the history of vessel movements, which provides insight into safeguarding the identification of the spill
source. If an oil slick is detected, investigators are able to use the information from the AIS system in reconstructing which ships
moved through a particular area when this oil slick was present. The information broadcasted from the AIS system includes such
data as the ship's identification, position, course, and speed, thus allowing the authorities to track which vessels were present and
when they were there. Once this data is assessed, ships may be identified that could have been responsible, such as tankers or any
other vessels carrying oil. Vessels that deviate from their given courses, come to a sudden stop, or display other unusual behavior
are good candidates for suspicion. 
Moreover, there is the necessity to combine the information from the AIS with some environmental information, such as ocean
currents and wind patterns, in order to construct an improved model about how the oil spill may spread. This leads to a better
prediction of the spill's trajectory, while also providing insight about where to put containment and cleanup efforts. AIS records
serve as justification for any legal case against vessels responsible for oil spills, therefore, making it a key aspect of maritime
enforcement. Simply put, AIS gives the background needed to explain vessel activity, which is necessary for the identification of
possible sources and the tracking of oil spill impacts.

## C. Ship Tracking (AIS) in Oil Spill Detection

### 1) The Automatic Identification System (AIS) is a system for locating ships designed to provide information about the position,
speed, course, and identity of vessels in real time. Ships do the information transmission via VHF radio signals. The
transponders always send this data to authorities, researchers, and organizations interested in monitoring vessel movements.

### 2) A Simple Explanation on the Role of AIS in Oil Spill Detection: This is the part is where it raises the question of "How does
AIS help in the Oil Spill Detection?" It would look deep into this question by highlighting oil spills sources of the Marine
environment as one of its major foci.

### 3) The Four-Step Process of Using AIS in Oil Spill Detection:
Step 1: Vessel Movements Surveillance:
Gathering AIS data from the vessels in the questionable region of the sea; Close monitoring of ships particularly transporting oil or
other hazardous matters;Data included ship identification, type of ship, route history, speed and current status (anchored, moving,
etc.).
Step 2: Flagging anomalous behavior that would:
Draw attention with sudden speed variations, curbing their course, etc., thus being suspected of illegal discharge; Attention is given
to ships that purportedly turn off their AIS transponders in open waters to evade detection and may be dumping illegally.
Step 3: In combination with remote sensing data:
Once a satellite image identifies the oil slick (SAR or optical or thermal sensors), the position is overlaid on the corresponding AIS
data to check what ships could be in them. If an oil slick is identified, the AIS data will also allow the historic record of this
flapping boat to be made.
Step 4: Confirming the oil spill and alerting authorities for real-time response:
Once an oil spill is confirmed and the ship identified, real-time alerts are given to authorities to make quick action; Environmental
agencies and Coast Guard employ AIS data as legal torque in investigating and punishing polluters. Integrated with remote sensing
and artificial intelligence-based analytics, AIS can provide better oil spill detection and monitoring. This suitable collaboration
brings about quick reactions, improved enforcement, and the protection of marine ecosystems from impending damages. Future
developments in AI-based anomaly detection coupled with satellite surveillance will only increase the potential of AI.

# III. METHODOLOGY
The oil spill detection modelling process involves many stages: data collection, preprocessing, analysis, prediction and preparation
for response planning. By combining remote sensing, AIS data and AI, the oil spill detection models offer precise identification,
tracking, and movement prediction.
The process for modeling begins with data collection, involving several data sources, including satellites, aerial unmanned drone
footage, and oceanographic information. Satellite images mostly providing from synthetic aperture radar and optical sensors enables
to detect oil spills under any weather conditions. The AIS tracks all vessel movements to provide pollution sources evidence by
keeping records of ship locations, speed, and course, among others. Also, oceanographic and meteorological data are acquired-wind
speed, sea currents, and wave height, respectively-to understand how an oil spill would spread through its duration.
Then follows the data preprocessing, and, a little before that, data fusion. This involves remote sensing image processing to noise
removal, contrast enhancement, and aligning of all datasets to a common coordinate system. Following that, for a better
representation of vessel movement, AIS data should be cleaned up to eliminate duplicating or inconsistent records. Finally,
integrating satellite imagery-AIS ship tracking and environmental parameters-in one with data fusion techniques renders an overall
assessment of possible oil spills. This is then an AI and ML based oil spill detection model. The model extracts relevant features
from the satellite images, Darcy slicks on SAR images, spectral signatures in optical images, and thermal anomalies in infrared
images. Likewise, analysing the AIS info recognizes suspicious behaviors, such as sudden speed drops, undesired route changes, or
loss of the AIS signal, which may indicate illegal discharges. Different technologies, including machine learning algorithms,
supervised classification models, deep learning convolutional neural networks (CNNs), and unsupervised anomaly detection
techniques, are used to differentiate true oil spills from false positives, such as wave shadow or algal bloom. Once the oil spill is
pinpointed, predictive models simulate their movements according to hydrodynamic and atmospheric factors. Spill drift simulations
scale how the oil slick will unfold over time according to the wind, currents, and water temperature. From there, environmental
impact assessments will gauge what potential effects these spills have on marine ecosystems and the coasts. These simulations help
the response teams effectively mobilize during containment and cleanup efforts. Regarding informing authorities, operators will
receive real-time alerts enabling them to initiate prompt response actions. Decision support systems analyze the data to determine
the best containment strategies to deploy, including booms, skimmers, or chemical dispersants when required. By tracking this, the
AIS also helps catch which vessels are responsible, giving the polluters legal enforcement. Example diagrams include model
continual refinement through ground-truth verification, a process in which observations from the field validate model predictions.
Past oil spill case studies are another form of trainable data that continues to enhance model functions.
Also, advancement in satellite technology further fine-tunes hyper spectral sensor and AI-based pattern recognition capabilities into
regional spill detection routines .In a nut shell, all in oil spill detection modeling works using multi-technology platforms of remote
sensing, ship tracking, Artificial Intelligence, and oceanographic simulation to offer a rapid response operation in the detection,
tracking, and responding to an oil spill efficiently and reliably. With such a comprehensive system in place, maritime environmental
safety is greatly enhanced through a far quicker response mechanism against illegal discharges and improved long-term monitoring
of marine ecosystems.

## A. Swin Transformer for Oil Spill Detection
Swin Transformer is a state-of-the-art model in image processing, particularly in semantic segmentation. The Swin Transformer
features hierarchical representation of image features and a shifted window mechanism, thus performing better than ordinary Vision
Transformers (ViT).

### 1) Input Processing: Remote sensing images (SAR, optical, or infrared) are divided into small patches. Hierarchical feature
extraction, not simply CNN-extracted features like the CU-Net .Operates on shifted windows, focusing on a specific region of
an image while retaining the spatial relationships of the image .A self-attention mechanism is in position to capture long-range
dependencies .Segmentation output: Produces pixel-wise oil spill segmentation maps.

### 2) Advantages of the Oil-Spill Segmentation: Captures global and local context with equal efficiency .Handles multi-inland
images much better than CNNs. Works well for multi-spectral satellite and SAR images. Cuts computation costs in comparison
to standard vision transformers.

# Swin Transformer Architecture

## Input

* Input image tensor shape: `H × W × 3`

## Initial Patch Partition

* Apply **Patch Partition** to the input image.
* The resulting patches are passed to a **Linear Embedding** layer.

## Stage 1

Input/output feature resolution:

* Spatial resolution: `H/4 × W/4`
* Channels: `C`

Processing:

1. Linear Embedding
2. **Swin Transformer Block ×2**

Output:

* Shape: `H/4 × W/4 × C`

## Stage 2

Before Stage 2:

* Apply **Patch Merging**.
* Spatial resolution is reduced by 2× in each dimension.
* Channel dimension is increased from `C` to `2C`.

Processing:

1. Patch Merging
2. **Swin Transformer Block ×2**

Output:

* Shape: `H/8 × W/8 × 2C`

## Stage 3

Before Stage 3:

* Apply **Patch Merging**.
* Spatial resolution is reduced by 2× in each dimension.
* Channel dimension is increased from `2C` to `4C`.

Processing:

1. Patch Merging
2. **Swin Transformer Block ×6**

Output:

* Shape: `H/16 × W/16 × 4C`

## Stage 4

Before Stage 4:

* Apply **Patch Merging**.
* Spatial resolution is reduced by 2× in each dimension.
* Channel dimension is increased from `4C` to `8C`.

Processing:

1. Patch Merging
2. **Swin Transformer Block ×2**

Output:

* Shape: `H/32 × W/32 × 8C`

## Complete Sequential Flow

```text
Input Image
H × W × 3
    ↓
Patch Partition
    ↓
Linear Embedding
    ↓
Stage 1
  Swin Transformer Block ×2
  Output: H/4 × W/4 × C
    ↓
Patch Merging
    ↓
Stage 2
  Swin Transformer Block ×2
  Output: H/8 × W/8 × 2C
    ↓
Patch Merging
    ↓
Stage 3
  Swin Transformer Block ×6
  Output: H/16 × W/16 × 4C
    ↓
Patch Merging
    ↓
Stage 4
  Swin Transformer Block ×2
  Output: H/32 × W/32 × 8C
```

### Architecture Summary

| Stage           | Operation                          | Swin Blocks | Output Shape       |
| --------------- | ---------------------------------- | ----------: | ------------------ |
| Input           | Image                              |           — | `H × W × 3`        |
| Patch Embedding | Patch Partition + Linear Embedding |           — | `H/4 × W/4 × C`    |
| Stage 1         | Swin Transformer                   |           2 | `H/4 × W/4 × C`    |
| Stage 2         | Patch Merging + Swin Transformer   |           2 | `H/8 × W/8 × 2C`   |
| Stage 3         | Patch Merging + Swin Transformer   |           6 | `H/16 × W/16 × 4C` |
| Stage 4         | Patch Merging + Swin Transformer   |           2 | `H/32 × W/32 × 8C` |

## B. U-Net for Oil Spill Detection
The U-Net is a CNN architecture for image segmentation designed specifically for oil spill detection. It follows a symmetric
encoder-decoder structure, making it suitable for oil spill detection. Encoder - By taking advantage of convolutional layers, it
extracts important features from the input image. Bottleneck Layer - This layer captures very deep representations of oil spills.
Decoder - It up samples the feature maps back to the original image size. Skip Connections - These are necessary in order to
preserve the fine-grained details by means of combining multi-scale, low-level and high-level features. Final Output - It contains a
binary or multichannel segmentation map that indicates trials from oil to non-oil.

### 1) Advantages for Oil Spill Detection: Works well with small datasets (requiring few training samples); spatial details are
preserved due to skip connections; performs well for high-resolution SAR & optical images; fast and computationally more
efficient than transformer-based models.

# Original U-Net Architecture

## Input

* Input image: `572 × 572 × 3`

## Contraction Network (Encoder)

### Encoder Block 1

1. `3×3 Conv + ReLU`

   * `572×572×3 → 570×570×64`
2. `3×3 Conv + ReLU`

   * `570×570×64 → 568×568×64`
3. `2×2 Max Pool`

   * `568×568×64 → 284×284×64`

Save the `568×568×64` feature map for the first skip connection.

### Encoder Block 2

1. `3×3 Conv + ReLU`

   * `284×284×64 → 282×282×128`
2. `3×3 Conv + ReLU`

   * `282×282×128 → 280×280×128`
3. `2×2 Max Pool`

   * `280×280×128 → 140×140×128`

Save the `280×280×128` feature map for the second skip connection.

### Encoder Block 3

1. `3×3 Conv + ReLU`

   * `140×140×128 → 138×138×256`
2. `3×3 Conv + ReLU`

   * `138×138×256 → 136×136×256`
3. `2×2 Max Pool`

   * `136×136×256 → 68×68×256`

Save the `136×136×256` feature map for the third skip connection.

### Encoder Block 4

1. `3×3 Conv + ReLU`

   * `68×68×256 → 66×66×512`
2. `3×3 Conv + ReLU`

   * `66×66×512 → 64×64×512`
3. `2×2 Max Pool`

   * `64×64×512 → 32×32×512`

Save the `64×64×512` feature map for the fourth skip connection.

## Bottleneck

1. `3×3 Conv + ReLU`

   * `32×32×512 → 30×30×1024`
2. `3×3 Conv + ReLU`

   * `30×30×1024 → 28×28×1024`

## Expansion Network (Decoder)

### Decoder Block 1

1. `2×2 Up-Conv`

   * `28×28×1024 → 56×56×512`
2. Crop the corresponding encoder feature map:

   * `64×64×512 → 56×56×512`
3. Concatenate:

   * `56×56×512` up-conv output
   * `56×56×512` cropped skip connection
   * Result: `56×56×1024`
4. `3×3 Conv + ReLU`

   * `56×56×1024 → 54×54×512`
5. `3×3 Conv + ReLU`

   * `54×54×512 → 52×52×512`

### Decoder Block 2

1. `2×2 Up-Conv`

   * `52×52×512 → 104×104×256`
2. Crop corresponding encoder feature map:

   * `136×136×256 → 104×104×256`
3. Concatenate:

   * `104×104×256 + 104×104×256`
   * Result: `104×104×512`
4. `3×3 Conv + ReLU`

   * `104×104×512 → 102×102×256`
5. `3×3 Conv + ReLU`

   * `102×102×256 → 100×100×256`

### Decoder Block 3

1. `2×2 Up-Conv`

   * `100×100×256 → 200×200×128`
2. Crop corresponding encoder feature map:

   * `280×280×128 → 200×200×128`
3. Concatenate:

   * `200×200×128 + 200×200×128`
   * Result: `200×200×256`
4. `3×3 Conv + ReLU`

   * `200×200×256 → 198×198×128`
5. `3×3 Conv + ReLU`

   * `198×198×128 → 196×196×128`

### Decoder Block 4

1. `2×2 Up-Conv`

   * `196×196×128 → 392×392×64`
2. Crop corresponding encoder feature map:

   * `568×568×64 → 392×392×64`
3. Concatenate:

   * `392×392×64 + 392×392×64`
   * Result: `392×392×128`
4. `3×3 Conv + ReLU`

   * `392×392×128 → 390×390×64`
5. `3×3 Conv + ReLU`

   * `390×390×64 → 388×388×64`

## Output Layer

1. `1×1 Conv`

   * `388×388×64 → 388×388×2`
2. Output segmentation map:

   * `388 × 388 × 2`

## Complete Flow

```text
INPUT
572×572×3
    │
    ├── 3×3 Conv → 570×570×64
    ├── 3×3 Conv → 568×568×64 ────────────────┐
    └── 2×2 MaxPool → 284×284×64               │
                                                │ Skip 1
    ├── 3×3 Conv → 282×282×128                 │
    ├── 3×3 Conv → 280×280×128 ────────────┐   │
    └── 2×2 MaxPool → 140×140×128           │   │
                                            │   │ Skip 2
    ├── 3×3 Conv → 138×138×256              │   │
    ├── 3×3 Conv → 136×136×256 ────────┐   │   │
    └── 2×2 MaxPool → 68×68×256         │   │   │
                                        │   │   │ Skip 3
    ├── 3×3 Conv → 66×66×512            │   │   │
    ├── 3×3 Conv → 64×64×512 ───────┐   │   │   │
    └── 2×2 MaxPool → 32×32×512      │   │   │   │
                                     │   │   │   │ Skip 4
    ├── 3×3 Conv → 30×30×1024        │   │   │   │
    └── 3×3 Conv → 28×28×1024        │   │   │   │
                                     │   │   │   │
    ┌── 2×2 Up-Conv → 56×56×512      │   │   │   │
    ├── Crop Skip 4 → 56×56×512      │   │   │   │
    ├── Concatenate → 56×56×1024     │   │   │   │
    ├── 3×3 Conv → 54×54×512         │   │   │   │
    └── 3×3 Conv → 52×52×512         │   │   │   │
                                     │   │   │   │
    ┌── 2×2 Up-Conv → 104×104×256    │   │   │   │
    ├── Crop Skip 3 → 104×104×256    │   │   │   │
    ├── Concatenate → 104×104×512    │   │   │   │
    ├── 3×3 Conv → 102×102×256       │   │   │   │
    └── 3×3 Conv → 100×100×256       │   │   │   │
                                     │   │   │   │
    ┌── 2×2 Up-Conv → 200×200×128    │   │   │   │
    ├── Crop Skip 2 → 200×200×128    │   │   │   │
    ├── Concatenate → 200×200×256    │   │   │   │
    ├── 3×3 Conv → 198×198×128       │   │   │   │
    └── 3×3 Conv → 196×196×128       │   │   │   │
                                     │   │   │   │
    ┌── 2×2 Up-Conv → 392×392×64     │   │   │   │
    ├── Crop Skip 1 → 392×392×64     │   │   │   │
    ├── Concatenate → 392×392×128    │   │   │   │
    ├── 3×3 Conv → 390×390×64        │   │   │   │
    └── 3×3 Conv → 388×388×64        │   │   │   │
                                     │   │   │   │
    └── 1×1 Conv → 388×388×2
             │
             ▼
       OUTPUT SEGMENTATION
          388×388×2
```

## Key Properties

* Architecture type: **U-Net**
* Encoder blocks: **4**
* Bottleneck: **1**
* Decoder blocks: **4**
* Convolution: `3×3`, followed by ReLU
* Downsampling: `2×2` max pooling
* Upsampling: `2×2` up-convolution
* Skip connections: **4**, using **copy-and-crop + concatenation**
* Final layer: `1×1` convolution
* Input: `572×572×3`
* Output: `388×388×2`
* Convolutions are **unpadded ("valid")**, which is why spatial dimensions shrink after each `3×3` convolution.


## C. DeepLabV3+ for Oil Spill Detection:
DeepLabV3+ is a trendy and prosperous deep-learning CNN-based architecture that combines atrous (dilated) convolutions and
spatial pyramid pooling for fine segmentation. Atrous convolution: Expanding the receptive field for gluing the oil features at multiscales without increasing computational cost. Atrous spatial pyramid pooling: Using different sizes of receptive fields and capturing
global and local oil spill features.

### 1) Encoder-decoder architecture: Encoder: Has a modified ResNet or Xception backbone for extracting deep features. ASPP:
Processing oil spills at different scales. Decoder: Up sampling feature maps for accurate boundary detection. Final output: A
high-resolution segmentation map with oil spills highlighted. Advantages in oil spill detection: Deals well with complex oil
features and shapes. Boosts segmentation accuracy compared to plain CNNs. Effective for SAR images and multispectral
satellite data. It is a trade-off between detail keeping and computational efficiency.

### 2) Conclusion: For fast and lightweight segmentation, U-Net; for high accuracy and intricate oil spill structures, DeepLabV3+; for
large-scale satellite imagery and advanced modeling, Swin Transformer.

# Atrous Convolution + ASPP Encoder–Decoder Architecture

## Overall Architecture

The network consists of two main parts:

1. **Encoder**

   * Atrous Convolution
   * ASPP (Atrous Spatial Pyramid Pooling)
2. **Decoder**

   * Low-level feature projection
   * Feature upsampling
   * Concatenation with low-level features
   * Convolution
   * Final upsampling

---

# Encoder

## Input

* Input: image

```text
Input Image
    ↓
Atrous Convolution Encoder
```

The encoder produces feature maps at different spatial resolutions.

The encoder output is used in **two ways**:

* The main/high-level feature output is sent to the **ASPP module**.
* A lower-level feature map from the encoder is sent directly to the decoder through a `1×1 Conv`.

---

# ASPP Module

The high-level encoder feature map is passed into **ASPP (Atrous Spatial Pyramid Pooling)**.

ASPP contains **five parallel branches**:

### Branch 1

```text
1×1 Conv
```

### Branch 2

```text
3×3 Conv
```

### Branch 3

```text
3×3 Conv
```

### Branch 4

```text
3×3 Conv
```

### Branch 5

```text
Image Pooling
```

The outputs of all five branches are then **concatenated**.

```text
                    ┌── 1×1 Conv ─────────┐
                    │                     │
Encoder Output ─────┼── 3×3 Conv ─────────┤
                    │                     │
                    ├── 3×3 Conv ─────────┤
                    │                     │
                    ├── 3×3 Conv ─────────┤
                    │                     │
                    └── Image Pooling ────┘
                              ↓
                         Concatenate
                              ↓
                           1×1 Conv
```

The ASPP output is then passed to the decoder.

---

# Decoder

The decoder receives two feature streams:

## Stream 1 — High-Level Features

The output of the ASPP `1×1 Conv` is:

```text
ASPP Output
    ↓
Upsample
```

The upsampled high-level feature map is sent to the concatenation stage.

---

## Stream 2 — Low-Level Features

A lower-level feature map from the encoder bypasses the ASPP:

```text
Encoder Low-Level Feature
    ↓
1×1 Conv
```

This produces a reduced-channel low-level feature representation.

---

## Feature Fusion

The two streams are combined:

```text
                    ASPP
                     ↓
                  1×1 Conv
                     ↓
                  Upsample
                     ↓
                     ├──────────────┐
                     │              │
                     ↓              │
Low-Level Feature → 1×1 Conv        │
                     ↓              │
                     └──→ Concat ←──┘
                            ↓
                         3×3 Conv
                            ↓
                         Upsample
                            ↓
                         Output
```

---

# Complete Sequential Flow

```text
INPUT IMAGE
     │
     ▼
ATRous Convolution Encoder
     │
     ├──────────────────────────────────────────┐
     │                                          │
     │ Low-Level Feature                       │ High-Level Feature
     │                                          │
     ▼                                          ▼
  1×1 Conv                                    ASPP
     │                                          │
     │                              ┌───────────┼───────────┐
     │                              │           │           │
     │                           1×1 Conv   3×3 Conv    3×3 Conv
     │                              │           │           │
     │                              ├───────────┼───────────┤
     │                              │           │
     │                           3×3 Conv   Image Pooling
     │                              │           │
     │                              └─────┬─────┘
     │                                    ▼
     │                              Concatenate
     │                                    │
     │                                  1×1 Conv
     │                                    │
     │                                  Upsample
     │                                    │
     └───────────────┐                    │
                     ▼                    ▼
                  CONCATENATE ◄──────────┘
                     │
                   3×3 Conv
                     │
                  Upsample
                     │
                     ▼
                  OUTPUT
```

# Components and Their Roles

| Component                      | Function                                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Atrous Convolution             | Extracts features while maintaining a larger receptive field without requiring additional downsampling      |
| `1×1 Conv` in encoder shortcut | Projects/reduces low-level feature channels before fusion                                                   |
| ASPP                           | Captures contextual information at multiple spatial scales                                                  |
| `1×1 Conv` in ASPP             | One parallel ASPP feature branch and final ASPP feature projection                                          |
| `3×3 Conv` in ASPP             | Multiple parallel atrous-convolution branches with different receptive fields                               |
| Image Pooling                  | Captures global image-level contextual information                                                          |
| Concatenate                    | Combines the outputs of the ASPP branches                                                                   |
| Upsample                       | Increases spatial resolution of high-level features and eventually reconstructs the segmentation resolution |
| Decoder `Concat`               | Combines high-level semantic features with low-level spatial-detail features                                |
| Decoder `3×3 Conv`             | Refines the fused feature representation                                                                    |
| Final Upsample                 | Restores the feature map to the required output resolution                                                  |
| Output                         | Final semantic segmentation map                                                                             |

# Important Structural Detail

There are **two separate skip/feature paths** from the encoder:

```text
Encoder
   │
   ├── High-level features → ASPP → 1×1 Conv → Upsample ──┐
   │                                                       │
   └── Low-level features → 1×1 Conv ─────────────────────┤
                                                           ▼
                                                        Concat
                                                           ↓
                                                        3×3 Conv
                                                           ↓
                                                        Upsample
                                                           ↓
                                                         Output
```

The key idea is that **ASPP extracts rich multi-scale semantic information**, while the encoder's **low-level features preserve spatial details**. The decoder fuses both before producing the final segmentation map.

# IV. RESULTS
Automated Oil Spill Detection Capability Demonstrated: The developed system effectively showcases the potential for automated
oil spill detection through satellite imagery analysis. The integration of a Convolutional Neural Network (CNN) model, specifically
the U-Net architecture, into the processing pipeline has demonstrated a robust capability for identifying and segmenting potential oil
slicks within uploaded satellite images. The system outputs detection results with associated confidence scores, providing a
quantifiable measure of the model's certainty in its identification of oil spill events. This capability highlights the system's promise
for automating the labor-intensive task of manual image review in oil spill monitoring. Interactive and Informative Maritime Data
Visualization: The web-based platform offers a highly interactive and visually rich environment for maritime data exploration. The
integration of a Leaflet-based mapping interface enables users to effectively visualize vessel positions derived from Automatic
Identification System (AIS) data, alongside spatial representations of detected ship anomalies and historical oil spill incidents. Users
benefit from features such as location search functionality and base map layer switching, enhancing their ability to investigate
specific maritime areas and analyze spatial patterns related to vessel traffic and environmental events. This visualization component
provides a critical tool for situational awareness and maritime domain understanding. Functional Prototype for Core Monitoring
Tasks Validated: The Marine Oil Spill Monitoring System prototype successfully validates the feasibility of an integrated platform
for key marine environmental monitoring tasks. The system's functionality extends across several crucial areas, including: Vessel
Activity Visualization: Displaying and interacting with maritime vessel data on an interactive map. Anomaly Detection Review:
Filtering and examining detected ship anomalies based on type and severity, facilitating targeted investigation of unusual vessel
behaviors. Oil Spill Detection Testing: Uploading and processing satellite imagery through the AI-powered detection model to
obtain automated oil spill identification results. These combined functionalities demonstrate the system's potential as a
comprehensive tool for enhancing marine environmental surveillance and response capabilities. The prototype effectively integrates
data streams, advanced AI analysis, and a user-friendly interface to support informed decision-making in maritime safety and
environmental protection

# REFERENCES
- [1] Garcia, F., & Thomas, D. (2020). "Use of AIS and Remote Sensing Data for Oil Spill Detection in the Mediterranean Sea." Marine Pollution Bulletin, 150(1),
26-34.
- [2] Lu, W., & Zhao, S. (2019). "The Application of Satellite SAR for Monitoring Oil Spills in the Ocean." Remote Sensing, 11(12), 1432.
- [3] Manfreda, S., & Tarantino, A. (2021). "Integrating AIS Data and Satellite Imagery for Oil Spill Monitoring." International Journal of Environmental
Monitoring, 8(2), 112-125.
- [4] Solberg, A.H.; Brekke, C.; Husoy, P.O. Oil spill detection in Radarsat and Envisat SAR images. IEEE Trans. Geosci. Remote Sens. 2007, 45, 746–755.
[CrossRef].
- [5] Fingas, M.; Brown, C. Review of oil spill remote sensing. Mar. Pollut. Bull. 2014, 83, 9–23. [CrossRef] [PubMed].
- [6] Fingas, M.F.; Brown, C.E. Review of oil spill remote sensing. Spill Sci. Technol. Bull. 1997, 4, 199–208. [CrossRef].
- [7] Espedal, H.; Johannessen, O. Cover: Detection of oil spills near offshore installations using synthetic aperture radar (SAR). Int. J. Remote Sens. 2000, 21,
2141–2144. [CrossRef].
- [8] Kapustin, I.A.; Shomina, O.V.; Ermoshkin, A.V.; Bogatov, N.A.; Kupaev, A.V.; Molkov, A.A.; Ermakov, S.A. On Capabilities of Tracking Marine Surface
Currents Using Artificial Film Slicks. Remote Sens. 2019, 11, 840. [CrossRef].
- [9] Solberg, A.S.; Storvik, G.; Solberg, R.; Volden, E. Automatic detection of oil spills in ERS SAR images. IEEE Trans. Geosci. Remote Sens. 1999, 37, 1916–
1924. [CrossRef].
- [10] Fiscella, B.; Giancaspro, A.; Nirchio, F.; Pavese, P.; Trivero, P. Oil spill detection using marine SAR images. Int. J. Remote Sens. 2000, 21, 3561–3566.
[CrossRef].
- [11] Espedal, H. Satellite SAR oil spill detection using wind history information. Int. J. Remote Sens. 1999, 20, 49–65. [CrossRef].
- [12] Karantzalos, K.; Argialas, D. Automatic detection and tracking of oil spills in SAR imagery with level set segmentation. Int. J. Remote Sens. 2008, 29, 6281–
6296. [CrossRef]
