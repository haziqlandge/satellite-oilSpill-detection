Contents lists available at ScienceDirect 

# Marine Environmental Research 

journal homepage: www.elsevier.com/locate/marenvrev 


## Artificial intelligence for marine oil spill management: Recent advances and future directions 


Ziyu Wang<sup>a</sup> , Yawen Huang<sup>a</sup> , Guorui Zhang<sup>a</sup> , Zhihan Wang<sup>a</sup> , Zhi Chen<sup>a</sup> , Catherine N. Mulligan<sup>a</sup> , S. Samuel Li<sup>a</sup> , Maria Elektorowicz<sup>a</sup> , Biao Li<sup>a</sup> , Kenneth Lee<sup>b</sup> , Chunjiang An<sup>a,*</sup> 

a _Department of Building, Civil and Environmental Engineering, Concordia University, Montreal, QC, H3G 1M8, Canada_ b _Kenneth Lee Research Inc, Halifax, Nova Scotia, B3H 4H4, Canada_ 

|A R T I C L E I N F O|A B S T R A C T|
|---|---|
|_Keywords:_ Oil spill Artifcial intelligence Risk prediction Accident detection Accident response Marine environment|Marine oil spills are one of the most severe anthropogenic threats to oceanic ecosystems, coastal communities, and global economic stability. While traditional monitoring and response approaches have played a foundational role in oil spill management, their effectiveness is often constrained by limited accuracy, slow response times, and high operational risks. Recent advancements in artifcial intelligence (AI), particularly machine learning, computer vision, intelligent sensing, and robotics, have reshaped the landscape of oil spill detection, assessment, and emergency response. This review provides a comprehensive synthesis of AI-driven methodologies currently available for use across the full lifecycle of marine oil spill management. The contents examine AI-enabled risk prediction, failure forecasting, and toxicological and ecological impact assessments; AI applications in oil spill fate and transport modeling, such as physics-informed methods to ensure physical consistency, deep learning architectures for trajectory prediction, and uncertainty quantifcation techniques that enable probabilistic hazard assessments; integrated remote sensing systems, including autonomous robots; and intelligent manufacturing of remediation materials and the evaluation of AI-based decision support systems. This comprehensive overview of current developments and practical applications, aligned with stakeholder needs, identifes key challenges and provides recommendations for research on data availability, model generalization, interpretability, and system integration to advance AI-enabled, resilient, and environmentally responsible marine oil spill management practices.|


# 1. Introduction
Crude oil is the world's largest non-renewable energy source, followed by coal and natural gas (Purohit et al., 2024). Since the Second Industrial Revolution, crude oil has been the primary energy source driving urbanization, economic development, and technological innovation (Wang et al., 2025d). Numerous strategic advantages of oil, such as its liquid state, high energy density, and versatility, have driven sustained growth in oil exploration and utilization over the past century. These advantages form the cornerstone of the modern industrial world and are the source of wealth for oil-based economies (Llavero-Pasquina et al., 2024). At the end of the last century, the environmental problems caused by the massive use of fossil fuels and the energy crisis triggered 

by political instability in energy-producing countries began to receive increasing attention (Ji et al., 2020; Lyu et al., 2024). Nevertheless, oil remains a key component of the supply chain for 90% of today's industrially manufactured products (Delannoy et al., 2021). This enormous consumption has not only promoted social development but also fueled a growing thirst for oil, accounting for one-third of current global primary energy consumption. Today, almost every aspect of daily life depends on petroleum products and energy production derived from crude oil, which is only found in certain parts of the world (Wang et al., 2023). Due to the enormous global demand, crude oil is primarily transported worldwide by sea after extraction, as sea freight is the most economical mode of transportation (Greene et al., 2020). Accidental spills of crude oil and liquid hydrocarbons onto land and 

This article is part of a special issue entitled: Oil spills MERE published in Marine Environmental Research. 

* Corresponding author. 

_E-mail address:_ chunjiang.an@concordia.ca (C. An). 

https://doi.org/10.1016/j.marenvres.2026.108108 

Received 22 January 2026; Received in revised form 26 April 2026; Accepted 7 May 2026 Available online 8 May 2026 

0141-1136/© 2026 The Authors. Published by Elsevier Ltd. This is an open access article under the CC BY license ( http://creativecommons.org/licenses/by/4.0/ ). 


into water are commonly referred to as oil spills (Johann et al., 2020). Despite advances in technology and safety practices, accidental oil spills are unavoidable during the exploration, production, storage, transportation, and consumption phases. The leading causes of marine oil spills are natural disasters, control system and infrastructure failures, war, and ship accidents (Asif et al., 2022; Wan et al., 2022). According to Al-Sudani and Al-Suhail (2024), as technological and economic development advances, human errors and equipment failures account for more than 50% of oil spill accidents in maritime transport. The International Tanker Owners Pollution Federation Limited (ITOPF) reported over 10,000 non-war-related tanker oil spills from 1970 to 2024, with a total spill volume exceeding 5.9 million tonnes (ITOPF, 2025). Tanker spills in the ITOPF database are categorized by oil spill volume into three types: small (less than 7 tonnes), medium (7 to 700 tonnes), and large (more than 700 tonnes) (Sezer et al., 2023). Tanker spills account for nearly half the volume of all marine oil spills and are considered the leading source of global marine oil pollution (Bi et al., 2025b; Ciappa and Costabile, 2014). In addition, oil spill risks and accidents involving marine oil infrastructure, including drilling platforms and pipelines, cannot be ignored. The Deepwater Horizon oil rig exploded off the coast of Louisiana on April 20, 2010, releasing over 663,000 tonnes of crude oil, and remains one of the worst marine oil spills in history (Purohit et al., 2024). 

Crude oil and its refined products contain petroleum hydrocarbons that are toxic to marine ecosystems. Due to the acute toxicity of petroleum hydrocarbons, oil spills can suffocate fish and other aquatic animals, endangering marine species, and they can also block sunlight from reaching the water's surface, impairing photosynthesis in marine plants (Perhar and Arhonditsis, 2014). Among 1700 major oil spill accidents, 312 events (more than 15%) reported impacts on wildlife (Deng and Adzigbli, 2018; Jayarathna et al., 2024). For instance, the Exxon Valdez oil spill resulted in the deaths of approximately 250,000 seabirds and over 2800 sea otters, and the dolphin population's reproductive rate declined by 50% following the Deepwater Horizon oil spill (Monson et al., 2000; Onyeka Virginia et al., 2025). Marine oil spills also have profound impacts on island and coastal communities and social services through water pollution and the release of volatile organic compounds (VOCs), heavy metals, and polycyclic aromatic hydrocarbons (PAHs). Most aromatic compounds found in oil pose a significant threat to human health and can accumulate in the human body through the food chain (Xie et al., 2025). Genotoxic effects have been reported following large-scale oil spills, such as the Haven and Prestige tanker accidents (Mohammadiun et al., 2022). The impact of marine oil spills typically depends on a range of factors, including the oil's chemical composition and quantity, the affected area, weather conditions, and response practices (Hettithanthri et al., 2024). 

Predicting the spread path of oil spills and how it varies over time is a crucial challenge in oil spill management. Despite offering physically correct frameworks, conventional Lagrangian particle-tracking models, such as OpenDrift and MEDSLIK-II, still struggle with computational complexity and real-time adaptation (Vasconcelos et al., 2025). For oil spill detection and monitoring, as Jafarzadeh et al. (2021) noted, distinguishing oil contamination from natural surface films using SAR imagery alone is unreliable, particularly under low wind speed conditions. Furthermore, traditional oil spill response decision-making methods rely on static emergency plans or the subjective experience of on-site commanders, which may lead to improper resource allocation in large-scale accidents (Mohammadiun et al., 2022). In this context, various artificial intelligence (AI) technologies have been developed for oil spill detection and management. By leveraging AI-based technologies such as machine learning (ML), automated robots, and computer vision, the likelihood of potential accidents can be identified in real-time or near-real-time, the severity of oil spill accidents assessed, and response processes optimized, thereby enabling a shift from passive response to proactive prevention and intelligent response (Wang et al., 2025d; Zhang et al., 2025b). 

Fig. 1 shows the hierarchy and relationships of AI concepts (Huby et al., 2022) Nowadays, ML algorithms are becoming a particularly prominent AI technology, defined as algorithms that learn from data without being explicitly programmed (Kim et al., 2025; Tamascelli et al., 2022; Wan et al., 2024). ML technology cannot only be used for oil spill detection but also for high-accuracy prediction and analysis. According to previous research, combining ML and remote sensing technologies for oil spill detection yields significant synergies, improving detection ac-curacy rates and reducing overall cleanup costs (Conceiçao et al., 2021˜ ; Li et al., 2022a; Tian et al., 2025). Furthermore, to fully utilize data in oil spill applications, various ML algorithms have been developed, such as Support Vector Machines (SVMs), Random Forests, and Convolutional Neural Networks (CNNs), to increase accident recognition rates, analysis accuracy, and the rationality of response decisions (Wahono et al., 2025).

## Figure 1 — AI system classification and descriptions

**Artificial Intelligence**

The broadest field, aiming to create machines that mimic human cognitive functions like learning.

- Sub-branches: Machine learning, Robotics, Natural language processing, and Computer vision.

**AI SYSTEM CLASSIFICATION**

**Deep Learning**

Specific models within ML inspired by human brains, consisting of interconnected hidden layers of nodes.

**Machine Learning**

A subset of AI algorithms that allow machines to learn from data without explicitly programming.

- Sub-branches: Deep learning, Generative AI and large language models, and Ensemble learning.

*Fig. 1. AI system classification and descriptions.* 

Based on the limitations of traditional methodologies used for oil spill preparedness and response, this study first analyzes the application of AI technology in risk data analysis, predictive maintenance of oil infrastructure and containers, spatial risk assessment, and the prediction of toxic effects from oil spills, helping readers better enhance their understanding and awareness of AI-supported oil spill response from whole lifecycle views. Secondly, it analyzes strategies for leveraging AI to address challenges such as remote-sensing image recognition, multisource data fusion, and the impacts on marine ecosystems after oil spills, thereby meeting stakeholders' demands for high-quality oil spill accident detection and monitoring. In the fourth section, this study proposes AI-powered responses for Decision Support Systems (DSS), response robots, and intelligent manufacturing of spill remediation materials. In summary, this study provides researchers and stakeholders with a comprehensive knowledge framework of advanced AI-based technologies that can be applied across the lifecycle of oil spill response operations. By reviewing advanced models for oil spill detection, response, and recovery, this study addresses key stakeholder concerns and provides recommendations to advance the application of AI technologies. 

# 2. AI-assisted oil spill risk prediction and fate analysis
## 2.1. Data acquisition, integration, and preprocessing in oil spill risk prediction
Before the 21st century, traditional on-site monitoring and practices were the starting point for responding to oil spills. However, this approach had many shortcomings, including the risk of direct contact with oil and the inability to measure the extent of the spill accurately (Kwok et al., 2019). Therefore, accurately predicting oil spill trajectories, promptly delineating the affected area, and responding effectively to oil spills are the main demands of stakeholders, which are crucial for controlling oil spill impacts. The application of AI technology will significantly enhance the generation and analysis capabilities of massive datasets, enabling the detection of oil spill risks and accident correlations that are difficult for humans to perceive. 

By leveraging the Internet of Things (IoT) and integrating sensors, gateways, and cloud systems, real-time environmental data can be provided to support risk decision-making (Durlik et al., 2025; Surianarayanan and Chelliah, 2023). Specially designed sensors deployed on marine infrastructure and oil tankers wirelessly connect to gateways via protocols, such as LoRaWAN and NB-IoT (Elgharbi et al., 2025b). The gateways then aggregate the data and transmit it to cloud servers. The massive amounts of data stored in the cloud are then further processed by AI techniques to achieve accident risk assessment and oil spill trend analysis. AI empowers machines to perform intelligent tasks and make autonomous decisions based on input data, eliminating the need for explicit programming instructions for specific operations, as required for traditional computers (Al-Ruzouq et al., 2020; Obasi et al., 2026). Based on previous research, AI methods used for oil spill risk prediction include Boosted Regression Tree (BRT), Immune Algorithm (IA), Ant 


### Artificial Intelligence 

The broadest field, aiming to create machines that mimic human cognitive functions like learning. -Sub-branches: Machine learning, Robotics, Natural language processing, and Computer vision 


Deep Learning Specific models within ML inspired by human brains, consisting of interconnected hidden layers of nodes. 

Machine Learning A subset of Al algorithms that allow machines to learn from data without explicitly programming. -Sub-branches: Deep learning, Generative Al and large language models, and Ensemble learning 


electronic data with nearby vessels, shore stations, and satellites to help prevent oil spills caused by collisions at sea (Yang et al., 2024). Currently, AI techniques, including classification decision trees and deep learning, can be used to analyze AIS data for risk prediction and prevention (Barberi et al., 2025; Murray and Perera, 2021). More AI techniques and practices regarding spill risk prediction and prevention for other marine oil facilities are provided in Section 2.2. In addition, with the development of social media and other electronic platforms, misinformation and malicious content can directly affect the accuracy of AI-based risk prediction. Thanopoulou et al. (2023) developed an AI-enabled electronic platform called ES.AVE to identify stakeholder needs by integrating with AIS and monitoring disruptive information on social media, which has been employed in Greece (Eide et al., 2007). However, AIS-based models may use commercially sensitive data, or data sharing between states may be politically constrained. These examples underscore the crucial importance of AI systems that support fair and responsible use. 

## 2.2. Failure forecasting and predictive maintenance for marine oil facilities
To systematically review failure forecasting and predictive maintenance, the AI-driven methodologies discussed in this section are mapped into three primary task-based groups: classification, such as fault categorization; regression, such as remaining useful life estimation; and sequence modelling, such as time-series anomaly detection. AI technology, including ML, computer vision, intelligent sensing, and robotics, has demonstrated enormous potential in marine oil equipment fault monitoring and risk prediction as technology advances. Commonly used ML algorithms in oil spill practices include SVM, Random Forest (RF), and k-Nearest Neighbors (KNN), which can automatically learn and extract key features from massive amounts of data to predict equipment operating status and potential faults, significantly improving the intelligence and automation of equipment management (Bayazitova et al., 2024; Chatterjee et al., 2024). For example, Fang et al. (2023) accurately predicted the internal corrosion rate based on pipeline operating conditions by using RF and CatBoost techniques and leveraging thousands of datasets generated by simulation. As a branch of ML, deep learning techniques like CNN and LSTM further enhance the ability to monitor equipment by handling complex nonlinear relationships and high-dimensional data, thereby overcoming the limitations of traditional ML algorithms in feature engineering (Ahmed et al., 2023; Safonova et al., 2023). For example, time-frequency maps of offshore oil equipment vibration signals can be used to detect equipment anomalies accurately using CNNs (Hamza et al., 2025). As equipment operation, fault, and risk data accumulate, AI models can dynamically optimize their predictive performance, enabling system to adapt to equipment status in real time while reducing human intervention. Furthermore, AI technology can be integrated with expert systems, combining expert knowledge in oil spill response with data-driven predictive models to improve efficiency and the ability to process multi-source heterogeneous data like time series, images, and spatiotemporal fields (Yang et al., 2025b). 

Following fault monitoring and risk prediction, predictive maintenance represents a further application of AI in the risk control of marine oil equipment (Ucar et al., 2024; Wen et al., 2022). It leverages AI algorithms, such as deep learning, decision trees, and SVMs, to analyze data collected from equipment sensors, including pressure, temperature, vibration, and corrosion levels, to predict the timing of offshore oil equipment failures. Predictive maintenance allows operators to perform maintenance before a failure occurs, thereby avoiding costly downtime and reducing the risk of marine oil spills caused by equipment failure (Al-Sabaeei et al., 2023; Monteiro Martins et al., 2025; Zhong et al., 2023). Simion et al. (2024) developed an automatic assessment model for equipment technical condition using a KNN model to provide early warnings of operational deviations, reduce human error, provide 

advance notice of upcoming maintenance phases, and reduce costs. Wang et al. (2025b) integrated meta-learning convolutional shrinking neural networks, expert rules, and SVM models into a robust classification model to predict potential failures in oil equipment, thereby improving predictive maintenance strategies. In testing, the method achieved an accuracy of 0.98 and a precision of 0.93, representing a performance improvement of up to 25% compared to commonly used ensemble learning models. Currently, companies with extensive offshore oil facilities, such as Chevron, Shell, BP, ExxonMobil, and TotalEnergies, are adopting AI-driven predictive maintenance to enhance asset reliability and control oil spill risks (Ganesh Shankar, 2024). 

## Table 1 — Prediction accuracy and error evaluation

**Prediction accuracy and error evaluation of five marine oil spill response models under small-sized dataset conditions (Mohammadiun et al., 2022).**

| Technique | Training correlation coefficient | Training prediction error<sup>a</sup> | Training accuracy (%) | Testing correlation coefficient | Testing prediction error<sup>a</sup> | Testing accuracy (%) | Computation time (s) |
|---|---:|---:|---:|---:|---:|---:|---:|
| Gaussian process regression | 0.976 | 0.003 | 93.49 | 0.884 | 0.016 | 80.93 | 0.047 |
| Support vector regression | 0.919 | 0.011 | 86.39 | 0.867 | 0.018 | 80.30 | 0.016 |
| Gradient descent | 0.720 | 0.046 | 70.80 | 0.555 | 0.076 | 60.20 | 2.160 |
| Levenberg Marquardt | 0.865 | 0.019 | 82.54 | 0.689 | 0.046 | 68.84 | 0.472 |
| Bayesian regularization | 0.954 | 0.008 | 90.01 | 0.845 | 0.025 | 77.98 | 9.658 |

<sup>a</sup> The errors mentioned in this study are root mean square errors.

## Figure 2 — ML frameworks for prediction and assessment of oil pipeline failures

### (a) Framework of Criticality Evaluation for Oil & Gas Pipelines

**1. Data collection strategy**

**(1) Subjective data**
- Identification of expert group
- Determination of weight coefficients of experts
- Estimation of failure effect based on similarity aggregation method (SAM)

**(2) Objective data**
- Data from similar systems
- Data from historical records
- Data from physical models

**2. Fuzzy logic inference**
- Transportation interruption effects (C1)
- Safety / health effect (C2)
- Environmental / ecological effect (C3)
- Equipment maintenance effect (C4)
- Fuzzy rule base
- Fuzzy logic system (FLS)
- Fuzzy inference
- Criticality index (CI)

**3. Machine learning model**
- Lookup table (Data)
- Regression models
- Neural Network
- Random Forest
- SVR

### (b) Pipe Data Generation and Machine Learning

**Pipe Data Generation**
- Pipe Properties
- Corrosion Model
- Burst Failure Pressure Model
- Difference = |PF<sub>pred</sub> − PF<sub>exp</sub>|
- Uncertainties in parameters
- PF<sub>t</sub> = PF<sub>pred</sub> + μ + N(0, σ)
- Monte Carlo Simulation
- Operating Pressure
- P<sub>f</sub> = prob(z < 0)
- z = PF − P<sub>op</sub>
- Probability of Failure
- Classify pipelines

**Machine Learning**
- Training input
- Training output
- Test input
- Predicted Output
- Actual Output
- Machine Learning Algorithms
- Compare effectiveness of ML Algorithm

### (c) Data acquisition, feature extraction, and decision-making

- Natural gas gathering pipelines
- Data acquisition
- Training set
- Historical normal data
- Online data
- Normalization
- Sliding window
- Feature extraction
- Encoder
- Decoder
- LSTM-AE
- Detecting
- OCSVM
- Decision-making
- Leakage alarm
- Normal
- Hyperplane

*Fig. 2 illustrates three examples of ML frameworks for the prediction and assessment of oil pipeline failures.*

Yin et al. (2021) proposed a novel assessment framework that combines a multilayer perceptron, support vector regression, and random forests. In this framework, the impacts of transportation disruptions, safety, environmental conditions, and equipment maintenance are defined as factors influencing the severity of pipeline failures. In this case, fuzzy logic is used to generate a mapping between influencing factors and severity indicators, and a predictive model is established to assess the severity indicators of oil and gas pipelines. The study by Mazumder et al. (2021) utilized recent advances in ML to develop a feasible alternative to computationally intensive analytical methods for determining the failure risk of oil and gas pipelines and to assess the burst-failure risk of pipelines with active corrosion defects, accounting for the residual strength of pipelines with corrosion pits. Moreover, to reduce the dependence of leak detection methods on leak data and to fully utilize the numerous standard datasets generated under normal operating conditions, Zuo et al. (2022) proposed a semi-supervised leak detection method consisting of two parts: an improved long short-term memory autoencoder (LSTM-AE) network and a single-class support vector machine (OCSVM) to infer the existence of leaks. 

## 2.3. Oil spill hazard prediction and risk assessment
Beyond the source of marine oil spills, oil can deposit on the seabed or be carried by ocean waves, spreading its harmful effects to a broader range of aquatic ecosystems (Bi et al., 2025a; Hajji and Lucas, 2024). Therefore, predicting the extent of an oil spill's impact is crucial. However, traditional methods for assessing the predicted extent of oil spills are time-consuming, labor-intensive, and inaccurate (Cai et al., 2024). Consequently, stakeholders are turning to AI to predict the extent and risks posed by oil spills. For example, Baruque et al. (2010) employed case-based reasoning (CBR) and the Weighted Voting Superposition (WeVoS) algorithm, integrating a self-organizing map of historical marine oil spill data with optimal topographic ranking on the map, to accurately predict the presence of oil slicks in the surrounding waters after an incident. Furthermore, Genovez et al. (2023) used synthetic aperture radar sensors and transfer learning (TL) predictive models to identify and differentiate seepage oil slicks from oil spills on the sea surface, thereby accurately predicting oil spill hazards and supporting subsequent emergency response efforts. Sunken oil refers to oil that leaks to the bottom of a body of water, where it accumulates on the seabed and damages marine ecosystems, further impacting tourism and other economic activities. In this context, marine oil spills are a major contributor to the hazards of sunken oil (Zare et al., 2024; Zhou et al., 2022). To accurately predict and assess the hazards of sunken oil from oil spills, AI, especially ML, is increasingly being deployed by stakeholders. Saleh et al. (2023) developed an ML classifier to accurately infer features from a training dataset of 5437 California coastal areas, thereby predicting sediment toxicity in the Southern California Bight. 

The Environmental Sensitivity Index (ESI) for oil spills was initially developed in the 1970s to assess, predict, and mitigate the potential impacts of oil spills on coastlines (D'Affonseca et al., 2023). For generating a comprehensive ESI, AI-based classification algorithms, such as RF, can provide robust results across different types of data and classify 


that rely on loss-function regularization. For uncertainty quantification specifically, Kampouris et al. (2021) investigated atmospheric forcing uncertainties through ensemble simulations coupled with MEDSLIK-II, revealing substantial sensitivity to wind phase differences and enabling probabilistic hazard assessments that communicate outcome ranges rather than point predictions. Furthermore, Nordam et al. (2019) demonstrated that random walk schemes commonly employed for turbulent diffusion require careful implementation to avoid spurious accumulation artifacts when eddy diffusivity varies with depth. These considerations extend to AI-based models seeking to emulate these physical processes. 

In summary, AI methodologies have significantly advanced the modeling of oil spill fate and transport in trajectory prediction, source identification, and spill detection, including uncertainty quantification. These growing modeling capabilities will produce outputs that increasingly feed into core operational spill response detection and monitoring systems. Therefore, the following section will discuss how AI technologies are impacting detection and monitoring capabilities, thereby completing the overview of AI-supported oil spill management from trajectory forecasting and real-time surveillance. 

# 3. AI-driven detection and monitoring of oil spills
The development of marine transportation increasingly promotes the global economy but also increases the risk of oil spills. Considering that spilled oil can affect marine ecosystems and society's economy, accident detection and monitoring are needed. With the efforts of researchers, a wide range of advanced technologies have been applied to detect and monitor marine oil spills, including satellite synthetic aperture radar (SAR) and optical remote sensing, hyperspectral imaging, and airborne sensors (Hu et al., 2021; Kang et al., 2022; Naz et al., 2021; Odonkor et al., 2019). Although these techniques can identify the area of oil spills, some limitations still exist. Garcia-Pineda et al. (2020) demonstrated that weathering processes influence the intensity of the detection signal, the thickness of oil films, and local environmental conditions. To address complex natural environments, improving detection and monitoring efficiency requires a combination of AI and other detection techniques (Wang et al., 2025a; Wang et al., 2025c). 

#### _3.1. Remote sensing_ – _based oil spill detection and image recognition_ 

Oil spills require fast, wide-area, and repeated observations so that relevant personnel can respond more quickly (Almulihi et al., 2021; Fingas and Brown, 2017; Jafarzadeh et al., 2021; Motiee et al., 2025). Remote sensing has become an integral tool in the management of oil spills (Fingas and Brown, 2017). Remote sensing technologies for oil spill detection primarily include optical, SAR, and thermal infrared 

**Table 2**

Advanced AI technologies developed to support oil spill detection. 

|Remote sensing type|Problem addressed|Method|Reference|
|---|---|---|---|
|SAR|Lookalikes, class imbalance, and blurry boundaries|CNN and encoder- decoder with spatial attention|Arnob et al. (2025)|
|SAR|Manual interpretation ineffciency and domain|DeepLabv3 with semantic|Zakzouk et al.|
||adaptation issues|segmentation|(2025)|
|Multispectral optical|Flow disturbance and vegetation shading in lakes with a 3.3% boost in mAP@50|YOLO-ADHF- SimAM|Zhang et al. (2025c)|
|Optical|Transport-shaped slicks|Object-oriented|Jiang et al.|
|(Sentinel-2)|elongated by currents and vessel motion|fuzzy logic classifcation|(2023)|
|Hyperspectral|Spectral instability and|DAKD-SMS with|Dong et al.|
|imaging|limited labeled samples|ViT|(2025b)|


(TIR) (Dong et al., 2025a). Although remote sensing is a powerful tool Table 2 for oil spill detection, each technique has significant limitations. illustrates recently developed advanced AI technologies that support oil spill detection. Arnob et al. (2025) proposed an integrated deep learning solution to address challenges in oil spill segmentation for SAR imagery, including lookalike interference, class imbalance, and blurry boundaries. The research also developed a CNN framework with an encoder-decoder architecture and a spatial attention mechanism. This mechanism enables the model to focus on key areas, thereby effectively distinguishing oil spills from look-alike features such as low-wind areas and algal blooms. There are two key issues in marine remote sensing, which include the reliance on inefficient manual interpretation for SAR oil spill detection and the adaptation barriers of general-purpose models that contain adaptation barriers in specific maritime regions (Liu et al., 2025b; Mahmoudi Ghara et al., 2022; Zhang et al., 2022). To solve these problems, Zakzouk et al. (2025) developed a DeepLabV3+ deep learning-based semantic segmentation framework. This kind of AI technology has accomplished automated processing, replacing inefficient manual interpretation. At the same time, it achieves precise pixel-level segmentation and produces an accurate oil spill extent map. 

In addition to the advances in microwave radar remote sensing, significant progress has also been made in optical remote sensing. To address the difficulties in detecting oil spills in island lakes caused by flow disturbances and vegetation shading, Zhang et al. (2025c) developed an improved algorithm, YOLO-ADHF-SimAM. Based on the YOLOv11 object detection framework, this model effectively captures the diffusion characteristics of oil spills across multiple scales by integrating an Adaptive Diffusion Hierarchical Fusion (ADHF) module and incorporating a SimAM Simple Parameter-Free Attention Module (SimAM) to suppress interference from complex water surface backgrounds. The work successfully addressed irregularities in oil shape, multi-scale variation, and low contrast with the background. Moving from inland lakes to open coasts, the challenge shifts to spills dispersed by oceanic currents and vessel movements, often forming elongated stripes or filaments (García-S´anchez et al., 2022). Precisely detecting these transport-shaped slicks requires methods that leverage their distinct spatial and geometric signatures (Yang et al., 2025c). Jiang et al. (2023) proposed an object-oriented fuzzy logic classification method using Sentinel-2 imagery to detect transport-shaped oil spills in narrow ship channels. The method uses multi-scale segmentation and an optimized set of multi-feature parameters, combined with a fuzzy-logic classifier, to effectively distinguish oil spills from morphologically similar ship wakes. Experiments show that this method significantly outperforms pixel-based SVM and RF algorithms in terms of overall accuracy and the Kappa coefficient, providing a practical technical approach for oil spill monitoring in ship channels. 

Moreover, in the realm of optical remote sensing, to address the instability of oil spill spectra and the scarcity of labeled samples in remote oceans, Dong et al. (2025b) proposed an innovative AI framework, the Dynamic Adaptive Knowledge Distillation Model (DAKD-SMS). This model uses a Vision Transformer (ViT) as its core backbone, leveraging its built-in self-attention mechanism to capture the global spatial-spectral relationships of oil spill regions. The technology fully utilizes continuous spectral information from Visible (VIS) and Near-Infrared (NIR) to Short-Wave Infrared (SWIR), and specifically incorporates oil-sensitive indices, such as the Fluorescence Index (FI), to enhance feature extraction (Xu et al., 2025). Their work successfully addressed the core challenges of spectral signature instability caused by variations in oil film thickness and emulsification states, as well as the scarcity of labeled data. 

Overall, the studies reviewed in this section demonstrate that AI has substantially improved the capability of remote sensing image recognition for oil spill detection by enhancing automation, segmentation precision, and feature extraction across SAR, optical, and hyperspectral imagery. However, the current body of research also reveals several important limitations. First, many models are strongly sensor-specific 


study combined DeepLabv3+-derived oil slick maps with FAI information from multi-source optical imagery to characterize bloom dynamics and demonstrated that the synergistic pressures from co-occurring hazards produced substantially greater ecological risks than either stressor alone. In summary, the complementary studies mentioned above establish a cohesive methodological progression that couples advanced AI-driven surface pollution monitoring with ecologically grounded vulnerability evaluation, offering a robust scientific basis for targeted coastal protection and multi-hazard risk management.

## Figure 3 — ML model utilization examples for oil spill detection

**Machine Learning**

| Application | ML model |
|---|---|
| Oil Type Classification | CNN + Dynamic Convolution |
| Slick/Emulsion Identification | Autoencoder + CNN + ViT |
| Thickness/Concentration Quantification | U-Net |
| Oil Content Quantification | Cross-Attention Mechanism |
| Anomaly Detection & Early Warning | SRCNN + CNN |
| Oil-water Segmentation & Thickness Discrimination | CNN + GCN |

*Fig. 3. ML model utilization examples for oil spill detection.*

## Figure 4 — Distribution characteristics of the oil spill risk degree in Jiaozhou Bay

**The hazard of oil spills**

**Legend**
- Very low
- Low
- Moderate
- High
- Very high

**Map coordinates**
- 120°7'0"E
- 120°12'30"E
- 120°18'0"E
- 120°23'30"E
- 36°13'30"N
- 36°0'8"N
- 36°2'30"N

*Fig. 4. The distribution characteristics of the oil spill risk degree in Jiaozhou Bay (Ma et al., 2023).*

# 4. AI-enabled oil spill response
## 4.1. AI-based decision support systems
A marine oil spill accident is a complex and dangerous process, characterized by high uncertainty, tight schedules, and dynamic environmental conditions. Decision support systems (DSS) integrated with AI can help overcome these limitations. This kind of technology transforms emergency management from passive to active, achieving adaptive learning, uncertainty assessment, and real-time policy optimization through data-driven methods (Al-Ruzouq et al., 2020; Dong et al., 2025b). AI decision-support systems also integrate real-time data from remote sensing and ocean models, enabling optimized response strategies, accurate oil spill trajectory predictions, and more efficient resource allocation (Accarino et al., 2025). 

The selection of oil spill emergency response methods during emergency situations is vital, including mechanical recovery, chemical dispersion, or in-situ combustion. Related decisions depend on rapidly changing variables, such as the weathering of oil spills, sea conditions, and ecological sensitivity (French-McCay et al., 2018). ML algorithms have demonstrated effective analytical capabilities, enabling the handling of multi-dimensional datasets and the recommendation of optimal strategies. Early oil-spill decision-support systems were mainly based on physical trajectory models. For instance, the MEDSLIK-II system provides operational forecasting capabilities for the Mediterranean region. The system integrates the hydrodynamic field, wind force, and the weathering process of oil spills to simulate the migration path and final deposition point of the oil spill (De Dominicis et al., 2013a, 2013b). Although the systems mentioned above have significantly improved prediction accuracy during emergency response, they still cannot quantify uncertainties or quickly integrate new data streams. Similar limitations also exist in the operational forecasting environment implemented in the Mediterranean and Baltic Seas. Liubartseva et al. (2016) and Zodiatis et al. (2016) developed decision-making tools embedded with deterministic models to support coastal risk assessment and trajectory prediction. 

Recent studies have proposed several comprehensive decisionsupport system architectures that can systematically address these multidimensional challenges. Table 3 illustrates the techniques commonly used in integration frameworks, such as combining Monte Carlo simulation with artificial neural networks for vulnerability analysis and combining simulation with optimization for resource allocation (Balogun et al., 2018). An important advancement in decision support systems is the ability to handle system uncertainties through 

probabilistic modeling, providing robust decision support for stakeholders in accidents under unpredictable circumstances (Davies and Hope, 2015). In addition, the emergence of open-source decision support system frameworks has enhanced the accessibility and collaborative improvement capabilities of these systems, enabling greater transparency and customization tailored to regional conditions (Lopez ´ et al., 2021). 

One of the core functions of the DSS is to predict the trajectory of oil spill diffusion accurately. The latest research shows that Bayesian optimization can automatically calibrate physical parameters using satellite observation data, thereby significantly improving the predictive accuracy of traditional physical models (Keramea et al., 2021). The hybrid modeling method combining ANN and Gaussian process regression (GPR) enhances the applicability of emergency response methods under specific environmental conditions and bridges the gap between traditional simulation and data-driven AI (Mohammadiun et al., 2022). In this context, advanced AI models can process historical oil pollution data to accurately predict the optimal timing for different technologies. For instance, some recent studies have adopted integrated ML models, such as random forests and XGBoost, combined with metaheuristic optimization algorithms to predict the efficacy of organic adsorbents, achieving high-precision predictions of oil removal rates (Le et al., 2025). In this context, the model enables emergency personnel to select the most effective adsorption material based on the specific viscosity and type of oil spill. 

After formulating the strategy, it is crucial to allocate limited resources, such as ships, skimmers, and oil booms, efficiently, which constitutes a complex combinatorial optimization problem in mathematics. However, AI-based algorithms have been proven highly effective for solving logistics problems under strict time constraints, including genetic algorithms (GAs), particle swarm optimization (PSO), and hybrid scheduling models. Currently, GAs are widely used to optimize ship routes. According to research by Li et al. (2022b), an improved GA was specifically proposed for scheduling emergency resources under a time-window constraint. This algorithm ensures that cleaning materials are transported from the shore to multiple accident sites before the oil spill becomes significant, and its performance is superior to that of the traditional manual scheduling method. The PSO algorithm has strong adaptability to the dynamic environment of oil drift and fragmentation. Ye et al. (2019) combined oil spill prediction with resource logic and developed a multi-agent PSO method based on simulation. This method enables emergency vessels to dynamically adjust their routes based on real-time updates to the oil spill location, thereby shortening response time and reducing fuel consumption as demands for time and resources change during the development of leakage incidents. Zhang and Lu (2024) proposed a multi-resource collaborative scheduling model (PSO-PGSA) based on a hybrid particle swarm optimization and plant growth simulation algorithm. PSO-PGSA can effectively handle complex logistics problems involving multiple resources, materials, and transportation networks, ensuring continuous long-term operational guarantees. 

In the early stages of an oil spill, available data are usually limited. AI technologies, such as Bayesian networks (BNs) and fuzzy logic, are used to model the causal relationships between risk factors and accidents. 

## Table 3 — AI technologies integrated in oil spill DDSs

**AI technologies integrated in oil spill DDSs.**

| AI technique | Primary function and applications | Key advantage | Reference |
|---|---|---|---|
| Bayesian optimization | Model parameter calibration and trajectory forecasting (e.g. Hybrid MEDSLIK-II integration) | Automatically tunes complex simulation models using satellite data, significantly improving predictive accuracy. | (De Dominicis et al., 2013a; Keramea et al., 2021) |
| ANN | Pattern recognition and nonlinear modeling (e.g. Vulnerability mapping) | Identifies complex relationships between environmental parameters and spill behavior for impact prediction. | Ning et al. (2024) |
| Bayesian statistical inference | Response technology screening and classification (e.g. Technology feasibility assessment) | Operates effectively with ambiguous or incomplete data, ranking countermeasures under uncertainty. | Davies and Hope (2015) |
| Multi-sensor data fusion | Spill characterization and feature analysis (e.g. Oil thickness estimation and classification) | Combines strengths of different sensors for a comprehensive situational picture. | (Dong et al., 2025b; Kalogirou et al., 2025) |

Sevgili et al. (2022) developed a data-driven BN to estimate the probability of an oil spill following an oil tanker accident. By analyzing variables such as ship age, accident types, and waterway characteristics, a quantified risk profile is provided to decision-makers, thereby enabling preventive resource mobilization when decisions involve conflicting goals, such as minimizing costs and maximizing environmental protection. The multi-criteria decision-making (MCDM) tool was thus adopted. In this case, the Fuzzy Analytic Hierarchy Process (Fuzzy-AHP) and the fuzzy TOPSIS method help quantify expert judgments and linguistic variables. Ye et al. (2020) demonstrated how to integrate human factors and operational errors into the decision matrix using fuzzy TOPSIS, thereby ensuring that the selected response strategy can consider potential human reliability issues. 

The latest generation of DSSs is evolving towards autonomous learning and strategic interaction modeling, encompassing deep reinforcement learning (DRL), game theory, and digital twin technology. DRL learns an optimal strategy through repeated trial-and-error in a simulated environment. Huang et al. (2020) proposed a hybrid framework combining DRL and case reasoning. In this system, AI is used to explore the potential oil spill evolution for learning and to select the minimum-impact strategy. Even in the face of new accident scenarios that are different from historical accident records, the optimal decision can still be made. In addition, Wu et al. (2024) applied DRL to autonomous path planning for sea search and rescue vessels, demonstrating the potential of DRL for controlling autonomous surface vessels (USVs) during cleanup. Emergency response actions typically involve multiple stakeholders, each with different priorities, including government regulatory agencies, accident parties, and private cleanup contractors. In this case, the cooperation mechanism among local governments, port enterprises, and clean-up units was modeled using stochastic evolutionary game theory (He et al., 2025). The simulation results can provide theoretical support for the design of incentive policies to ensure stable and efficient cooperation among all parties. Furthermore, the integration of AI and high-fidelity physical models is driving the development of marine digital twins. Accarino et al. (2025) recently demonstrated an AI-based prediction system that uses Bayesian optimization to adjust hydrodynamic models, such as MEDSLIK-II, in real time. Verified by the Banyas oil spill incident in 2021, the system improved trajectory prediction accuracy by 25%, thereby directly enhancing the DSS's ability to guide resources to the correct locations (Spanoudaki et al., 2023). Fig. 5 shows examples of oil spill accident analysis and decision supporting systems integrated with AI technologies. 

## Figure 5 — Examples of oil spill accident analysis and decision supporting systems integrated with AI technologies

### (a) Bayesian optimization

**Dispersion Scenario**
- FEA Simulations
- Real-World Situations
- Ground Truth
- x<sub>k</sub>

**USV**
- Sensor Measurements
- USV State
- Primitive Actions
- Best Action

**Bayesian Filter Estimator**
- Update
- Prediction
- Posterior
- P<sub>k</sub>
- x̂<sub>k</sub>

**Informative Path Planners**
- Utility
  - Variance
  - Exp Info Gain
- Searching Strategy
  - Myopic
  - MCTS

**Initial Guesses**
- ẑ<sub>0</sub>

**Reconstruction**

**Iterate N times through steps 1–4 by refining surrogate model and updating config params until convergence criteria are met.**

**1. Initialize MEDSLIK-II simulation params in config. files**

**Simulation Parameters Configuration**

**Physical Parameters Configuration**

**Bayesian Optimization**
- Acquisition Function (i.e., UCB)
- Fit the Surrogate Function (i.e., GP)
- Keep track of parameters and related objective score ([K<sub>h</sub><sup>(i)</sup>, α<sup>(i)</sup>, β<sup>(i)</sup>], FSS<sup>(i)</sup>)

**2. Evaluate Objective Function by running MEDSLIK-II and computing FSS**

**Objective Function**
- MEDSLIK-II Numerical Simulation
- Oil Spill Detection Data
- FSS

**3. Surrogate Model Update based on FSS values from step 2**

**4. Parameter Selection through acquisition function for next evaluation.**

### (b) Human factor analysis and preference evaluation

**Human factor analysis stage**
- Considered spill-related stages
- Survey
- Database
- Collected human /causal factors
- HFACS
- FTA
- Categorized failure factors

**Preference evaluation stage**
- Fuzzy Set Theory
- Multi-Criteria Decision Making (TOPSIS)
- Ranking results

Despite extensive progress, challenges still exist. The scarcity of data has long restricted the training of artificial intelligence models, as largescale, labeled datasets of past oil spill incidents are rarely publicly available. At the same time, due to differences in hydrodynamics, petroleum properties, and operational practices, models trained in one region may not generalize well to other regions. This issue has been reported in many modeling studies (French-McCay et al., 2018; Liubartseva et al., 2016). In many cases, models trained on specific geographic areas or types of oil spills exhibit degraded performance when applied to new scenarios (Keramea et al., 2021). Therefore, models and practices should be tested across different oceanographic regimes and oil classes before operational deployment. Furthermore, regional transfer tests, cross-sensor validation, and stress tests under extreme weather conditions would bridge the gap between theory and implementation. In addition, in practical operations, these AI outputs must be actionable for responders. However, many AI-enhanced DSS still have deficiencies in terms of transparency and interpretability (Kovari, 2024). In this case, the output of the AI system needs to be presented in a highly readable format on incident command systems, and audit trail practices can be implemented to ensure that AI recommendations can be overridden or challenged in high-stakes decisions. For example, trajectory ensemble uncertainty could be visualized on an incident command system dashboard as probabilistic heatmaps, enabling commanders to dynamically prioritize resource and boom 

deployments in high-risk zones dynamically. Furthermore, deploying such AI-assisted decision-making tools requires a minimum regulatory audit trail, such as logging model inputs, environmental parameters, and version histories, to ensure transparency and accountability in emergency response decisions. 

## 4.2. Oil spill response robots
The integration of AI and robotic platforms has fundamentally transformed the oil spill emergency response model, shifting it from labour-intensive manual cleaning to autonomous, scalable, and safetycentred operations. This phenomenon can be described as a key shift in the oil pollution emergency response mode from static passive control to dynamic intelligent intervention. The hallmark of this transformation is the emergence of autonomous supervised learning. In this mode, USVs, unmanned aerial vehicles (UAVs), and autonomous underwater vehicles (AUVs) operate in coordination as operational units within a unified framework, enabling autonomous navigation, adaptive coordination, real-time analysis of oil spill characteristics, and adaptive decision-making (Bae and Hong, 2023). The integration of AI and robots enables them to perform a variety of complex tasks ranging from detection to physical control and removal, thereby avoiding the health risks caused by exposing emergency personnel to volatile organic compounds and harsh sea conditions (Srinivasan and Babu, 2025). Fig. 6 shows examples of integrated autonomous response architectures for oil spill response robots. 

## Figure 6 — Integrated autonomous response architectures for oil spill response robots

### (a) Informative path planning

**Dispersion Scenario**
- FEA Simulations
- Real-World Situations
- Ground Truth

**USV**
- Sensor Measurements
- USV Stats
- Primitive Actions
- Best Action

**Bayesian Filter Estimator**
- Update
- Prediction
- Posterior
- P<sub>k</sub>
- x̂<sub>k</sub>

**Informative Path Planners**
- Utility
  - Variance
  - Exp Info Gain
- Searching Strategy
  - Myopic
  - MCTS

**Initial Guesses**

**Reconstruction**

### (b) Cooperative source seeking

**Kinematic model (5)**
- The model (2) is simplified by the coordinate transformations (3) and (4)

**Information fusion (15)**
- H<sub>∞</sub> filter (10)–(13)

**Space-time model**
- 2-D PDE model (1)

**High-pass filter (17)**
- δ(t) − he<sup>−t</sup>

**Extreme seeking**

**Gradient estimation (18)**
- Ĉ<sub>x</sub>(x<sub>c</sub>(t), y<sub>c</sub>(t), t)
- Ĉ<sub>y</sub>(x<sub>c</sub>(t), y<sub>c</sub>(t), t)

**Source seeking**
- Gradient-based control law (33)

**Cooperative source seeking**
- Formation control law (34)

*Fig. 6 shows examples of integrated autonomous response architectures for oil spill response robots.*

USVs are the main platforms for physical containment and surface recovery. The efficiency of surface operations largely depends on the robot's dynamic perception of pollutants, which in turn affects path planning. Ma et al. (2025) proposed an adaptive information path planning (IPP) strategy for the diffusion of water pollution. Unlike traditional coverage modes, this method uses a Gaussian process to model pollutant distributions and employs Monte Carlo tree search (MCTS) to optimize USV trajectories in real time. Therefore, USVs can proactively reconstruct the diffusion field and prioritize high-uncertainty and high-concentration areas, thereby significantly enhancing the speed and accuracy of oil spill mapping compared to static pre-planned routes (Ma et al., 2025). In addition, to address waves, drifts, and constantly changing oil spill boundaries, researchers can improve the navigation performance of ASVs under uncertain conditions by combining artificial intelligence-assisted planners with hydrodynamic models and adaptive algorithms (Jin and Ray, 2013). Subsequently, Vinoth Kumar et al. (2020) improved this method and developed an energy-aware path optimization algorithm for AUVs, called the Whale Cuckoo Search Optimization Algorithm (WCSOA), to identify oil stains near container ships. 

To cope with the complex and changeable marine environment and achieve the practical execution of paths. Ye et al. (2025) proposed a collaborative hierarchical framework that integrates the Swin-Transformer for visual perception, the T-ASTAR algorithm for global programming, and a DRL controller based on the twin-delay deep deterministic policy gradient (TD3) algorithm. The architecture enables USVs to generate real-time risk maps and optimize hydrodynamically efficient trajectories, maximizing battery life for long-duration sea-crossing missions while reducing the collision rate by approximately 65% (Ye et al., 2025). Elmakis and Degani (2023) demonstrated a hybrid reinforcement learning method that combines global visibility maps with local DRL agents, enabling USVs to clean up scattered oil stains while efficiently avoiding dynamic obstacles. 

To deal with large-scale oil spill accidents, individual robots are being replaced by collaborative multi-robot clusters. In an earlier study by Kaviri et al. (2019), Voronoi diagram partitioning was applied to achieve coverage for aerial robots, while Luo et al. (2022) explored collaborative oil spill boundary tracking using visual control. Other studies use reinforcement learning to enable distributed decision-making across heterogeneous ship clusters. For instance, the 


## Figure 7 — Intelligent manufacturing workflow

**Raw Materials & Data Input**
- BIOMASS
- POLYMERS
- SENSOR DATA

→ **AI-Driven Design & Simulation**

→ **Smart Manufacturing Units**

→ **Real-Time Process Control (AI Optimization)**

→ **Finished Product Storage & Logistics**

→ **Marine Application (Oil Spill Cleanup)**

**Quality Assurance & Defect Detection (AI Vision Systems)**

The workflow shows AI-driven design and simulation, smart manufacturing, real-time AI optimization, quality assurance and defect detection, finished-product storage and logistics, and marine application for oil spill cleanup.

### Table 4

**Comparisons of the performance of AI algorithms in sorbent improvement.**

| Material type | AI algorithm | Target variable | Outcome | Reference |
|---|---|---|---|---|
| Carbonaceous materials | Deep Learning in Neural Networks | Freundlich Coefficients (log Kf, n) | Highly accurate prediction of sorption isotherms for polar and non-polar pollutants | Sigmund et al. (2020) |
| Carbonized shungite | MLP-ANN | Oil Sorption Capacity | Outperformed multiple linear regression; captured nonlinear synthesis effects | Cristea et al. (2023) |
| Organic absorbents | XGBoost with Grey Wolf Optimization | Removal Efficiency (%) | Identified optimal dosage (2.41g) and contact time for 99.84% removal efficiency | Le et al. (2025) |
| Biopolymer composites | ANN with GA | Oil Recovery Rate (%) | Optimized biosurfactant-polymer flooding agent to achieve 45% tertiary oil recovery | (Elgarahy et al., 2025a) |

Traditional isothermal adsorption models often struggle to capture the complexity of multiple variables in real-world leakage events. Deep learning offers viable solutions. For instance, feedforward neural networks have successfully predicted the Freundlich adsorption isotherm fitting parameters of carbon-based materials, log KF and n (Sigmund et al., 2020). The multi-layer perceptron artificial neural network (MLP-ANN) and multiple linear regression (MLR) models outperform traditional linear regression in predicting crude oil adsorption capacity. By capturing the nonlinear relationship between carbonization temperature and oil absorption volume, a high correlation coefficient can be achieved (Cojocaru et al., 2011; Cristea et al., 2023). Furthermore, long short-term memory (LSTM) networks have been applied to adsorption kinetics modeling, accurately predicting the saturation point of the adsorbent bed and thereby optimizing the replacement strategy during active response operations (Skrobek et al., 2020). 

Intelligent manufacturing technology has enabled the development of a variety of high-performance, environmentally friendly biobased composite materials. Researchers combined ensemble learning models, such as Random Forest and XGBoost, with metaheuristic algorithms, such as Grey Wolf Optimization, to determine the optimal operational conditions (Le et al., 2025). This method determined specific dosage and contact time parameters, enabling the organic adsorbent to achieve an oil removal efficiency of up to 99.84%. Furthermore, the hybrid model combining ANN with GA has been used to optimize the formulation of biosurfactant-biopolymer oil displacement agents, achieving an oil recovery rate of 45% (Elgarahy et al., 2025a). Statistical methods, such as the central composite design (CCD), also played an important role in tailoring cellulose-based aerogels derived from agricultural waste. By optimizing the concentration of crosslinking agents, the diesel adsorption capacity was maximized, reaching 52.301 g/g (Trong et al., 2024). 

The intelligent synthesis of high-porosity aerogels and electrospun nanofibers represents a cutting-edge direction in artificial intelligencedriven manufacturing. To address the issue of nonuniformity in the synthesis-performance correlation, frameworks such as the Silica Aerogel Graph Database have been established. These frameworks enable neural network regression models to predict surface area and density solely from precursor inputs (Walker et al., 2023). In electrospinning, fiber morphology determines filtration efficiency. ANNs have been 

widely used to predict fiber diameter distributions from applied voltage and polymer concentration (Premasudha et al., 2020; Sarma et al., 2022 ). To address the complex trade-offs in fiber membrane design, the ML-assisted differential evolution (MLADE) strategy has been applied. The study utilized this method to simultaneously maximize mechanical strength, oil absorption rate, and water contact angle, thereby finding the optimal preparation parameters for the polystyrene/polyacrylonitrile membrane (PS/PAN) with a much lower experimental workload than is usually required (Wang et al., 2020). 

In addition to optimizing existing materials, AI is driving reverse design, in which algorithms generate new material structures that meet specific performance standards. Researchers combined molecular dynamics (MD) simulations with ML to rapidly screen vast chemical databases, thereby identifying optimal membrane formulations (Dangayach et al., 2025). Genetic algorithms are used to optimize the arrangement of hydrophobic and hydrophilic functional groups within nanopores, revealing counterintuitive designs that enhance selective transport through unexpected diffusion mechanisms (Jiao et al., 2022). The data-driven approach is also applicable to organic framework membranes (OFM). Furthermore, ML can help identify key environmental parameters and structural descriptors, thereby balancing permeability and selectivity (Wu et al., 2025). 

The application scope of artificial intelligence has expanded to include intelligent additive manufacturing, such as 3D printing, and lifecycle assessment (LCA) of remediation materials. Combining ML algorithms with 3D printing technology can optimize parameters such as printing speed, thereby minimizing waste and controlling surface roughness (Rahmani Dabbagh et al., 2022). At the same time, generative design algorithms have created complex organic lattice structures for Yan skimmers, thereby maximizing fluid flow and capture efficiency ( et al., 2016). In addition, AI models can quantify greenhouse gas emissions and production costs to ensure that the new biopolymer adsorbents are not only highly efficient but also cost-effective. The new type of biopolymer adsorbent is more economically feasible and environmentally sustainable compared with synthetic alternatives (Elgarahy et al., 2025). 

The integration of AI into the manufacturing of oil-spill remediation materials marks a shift from a traditional to a data-driven design process. Intelligent manufacturing provides a robust framework for developing marine oil-spill treatment materials that are responsive, high performing, and environmentally friendly. Researchers have integrated artificial intelligence to produce adsorbents with performance far exceeding that of traditional materials and have also integrated deep learning-based oil spill monitoring tools. Intelligent manufacturing is expected to play a key role in the global oil spill emergency response system, enabling faster, cleaner, and more adaptive interventions. However, although the models can effectively predict key properties such as the porosity and chemical composition of adsorbents, converting these materials from the laboratory to large-scale production is challenged by differences in manufacturing processes, lifecycle costs, and environmental restrictions. Moreover, theoretical performance often fails to explain the physical or biological degradation of these materials under actual wave action and harsh marine weather conditions, and their performance in real marine environments has not been fully studied. Therefore, to bridge this gap, standardized marine field tests and rigorous technical and economic evaluations are needed. 

# 5. Conclusions and recommendations for future research
AI is reshaping the entire spectrum of marine oil spill management by transforming risk prediction, fate and transport modeling, detection, hazard assessment, emergency decision-making, autonomous response, and the design of remediation materials. This review demonstrates that AI-driven advancements, ranging from remote sensing image classification and multisource data fusion to deep learning, enabled toxicological forecasting and intelligent robotics, significantly enhancing the 


accuracy, speed, and safety of spill monitoring and response operations. AI-based decision support systems now enable proactive, real-time strategy optimization, while intelligent manufacturing accelerates the development of environmentally sustainable sorbents and remediation materials. 

Despite rapid advancements in the application of artificial intelligence to marine oil spill management, there are still some challenges that hinder the development of fully reliable, scalable, and operationally ready systems. Of the seven challenges, the first three are applicable to the entire lifecycle of oil spill events, while the latter four are specific to certain stages or practices: 
- **1.** The scarcity of high-quality datasets from real spill events constrains model training and validation. Data confidentiality, inconsistent reporting practices, and the inherently unpredictable nature of spill occurrences result in fragmented and heterogeneous datasets that limit the robustness and generalizability of AI models. 
- **2.** Algorithms trained in specific geographic regions or on particular oil types often fail when applied to other spill scenarios due to differences in hydrodynamic conditions, sensor characteristics, and oil weathering behaviors. This lack of regional generalizability highlights the need for adaptive learning frameworks and multi-regional datasets to enhance cross-environment performance. Specifically, 
- **3.** Interpretability is still a key issue for oil spill detection and monitoring. Many deep learning models operate as opaque black boxes, making outputs difficult for emergency personnel to evaluate, especially under high-stakes, time-critical conditions. Therefore, improving model transparency through explainable AI and uncertainty quantification is essential for building trust among stakeholders. 
- **4.** AI-enhanced decision support systems face challenges integrating multiple data streams in real time while accounting for uncertainties in environmental forecasts, sensor noise, and data sparsity. In this context, achieving seamless integration between physical hydrodynamic models and data-driven approaches remains a significant challenge, as does developing digital twin platforms capable of continuously updating predictions and strategies as spill events unfold. 
- **5.** Real-time data assimilation presents difficulties for AI-based fate and transport models because neural network architectures need specialized development to effectively update learned representations from incoming satellite observations, capabilities that physics-based models have already established. However, AI approaches have not yet fully achieved this capability. Additionally, the lack of standardized benchmark datasets and validation protocols across different geographic regions complicates the assessment of model transferability and comparative performance. 
- **6.** Autonomous robotic systems, such as unmanned aerial, surface, and underwater vehicles, show immense potential, but are not yet mature enough to support large-scale full-cycle emergency response operations due to challenges in energy endurance, communication stability, swarm coordination, and environmental adaptability that remain to be addressed. 
- **7.** Intelligent manufacturing of advanced sorbents and remediation materials has produced promising laboratory results, but scaling up the production of a cost-effective, environmentally safe, regulatory-approved product, remains an elusive challenge. 

Among these seven interconnected challenges, generalizability is the highest priority, as the reliable deployment of AI models in real-world marine environments fundamentally depends on their ability to adapt to diverse, unseen spill scenarios. At the same time, the growing reliance on AI raises ethical, regulatory, and institutional challenges, including 

issues of data governance, transparency, and the equitable distribution of advanced response technologies. In addition, the effective adoption of AI-based tools requires acceptance by the oil spill response community, such as the Integrated Command System, which depends on trust in model outputs, alignment with established decision-making protocols, and clear regulatory guidance. Based on the challenges mentioned above, future research must therefore focus on establishing standardized datasets, including benchmarks for oil spill trajectory prediction across diverse oceanographic conditions, developing transferable and interpretable models and foundation models trained on large-scale oceanographic datasets, enhancing multi-sensor fusion systems integrating satellite imagery, vessel tracking, and numerical model outputs within unified architectures, designing robust multi-robot coordination frameworks, and accelerating the translation of intelligent materials from laboratory prototypes to operational use. Equally important is the need for international collaboration to develop ethical, regulatory, and operational guidelines, and training tools that ensure the responsible and sustainable deployment of AI for marine environmental protection. Interdisciplinary cooperation across AI, ocean sciences, environmental engineering, and policy-making will be essential to build a comprehensive, intelligent, and adaptive system for global marine oil spill prevention and mitigation. When these challenges are addressed, AI has the potential to substantially reduce ecological damage, improve emergency response readiness, and strengthen the sustainability of marine ecosystems worldwide. 

#### **CRediT authorship contribution statement** 

**Ziyu Wang:** Data curation, Formal analysis, Investigation, Visualization, Writing – original draft. **Yawen Huang:** Formal analysis, Investigation, Visualization, Writing – original draft. **Guorui Zhang:** Formal analysis, Investigation, Visualization, Writing – original draft. **Zhihan Wang:** Investigation, Writing – original draft. **Zhi Chen:** Writing – review & editing. **Catherine N. Mulligan:** Writing – review & editing. **S. Samuel Li:** Writing – review & editing. **Maria Elektorowicz:** Writing – review & editing. **Biao Li:** Writing – review & editing. **Kenneth Lee:** Writing – review & editing. **Chunjiang An:** Conceptualization, Resources, Supervision, Writing – review & editing. 

#### **Declaration of competing interest** 

The authors declare that they have no known competing financial interests or personal relationships that could have appeared to influence the work reported in this paper. 

#### **Acknowledgements** 

This research was supported by the Multi-partner Research Initiative of Natural Resources Canada, the Natural Sciences and Engineering ´ Research Council of Canada, and the Fonds de recherche du Quebec – Nature et technologies (FRQNT). The authors are also grateful to the anonymous reviewers for their insightful comments and suggestions. 

#### **Data availability** 

No data was used for the research described in the article. 

#### **References** 

- Abiye, W., Dengiz, O., 2025. Digital mapping of soil erodibility factor in response to land use change using machine learning models. Environ. Syst. Res. 14 (1), 14. https:// doi.org/10.1186/s40068-025-00402-w. 

- Accarino, G., De Carlo, M.M., Ruiz Atake, I., Elia, D., Dissanayake, A.L., Neves, A.A.S., Ibanez, J.P., Epicoco, I., Nassisi, P., Fiore, S., Coppini, G., 2025. Improving oil slick ˜ trajectory simulations with bayesian optimization. Ecol. Inform. 91, 103368. https://doi.org/10.1016/j.ecoinf.2025.103368. 

- Ahmed, S.F., Alam, M.S.B., Hassan, M., Rozbu, M.R., Ishtiak, T., Rafa, N., Mofijur, M., Shawkat Ali, A.B.M., Gandomi, A.H., 2023. Deep learning modelling techniques: 


current progress, applications, advantages, and challenges. Artif. Intell. Rev. 56 (11), 13521–13617. https://doi.org/10.1007/s10462-023-10466-8. 

- Ait Ayane, F., El Khamlichi, B., Seghrouchni, A.E.F., 2025. Distributed cooperative uav leader-follower strategies in gnss-denied environments. 2025 21st International Conference on Distributed Computing in Smart Systems and the Internet of Things (DCOSS-IoT). 

- Al-Ruzouq, R., Gibril, M.B.A., Shanableh, A., Kais, A., Hamed, O., Al-Mansoori, S., Khalil, M.A., 2020. Sensors, features, and machine learning for oil spill detection and monitoring: a review. Remote Sens. 12 (20), 3338. https://doi.org/10.3390/ rs12203338. 

- Al-Sabaeei, A.M., Alhussian, H., Abdulkadir, S.J., Jagadeesh, A., 2023. Prediction of oil and gas pipeline failures through machine learning approaches: a systematic review. Energy Rep. 10, 1313–1338. https://doi.org/10.1016/j.egyr.2023.08.009. 

- Al-Sudani, I.A., Al-Suhail, G.A., 2024. Image-based oil spill detection using deep learning techniques: a review. 2024 5th International Conference on Communications, Information, Electronic and Energy Systems (CIEES). https://doi.org/10.1109/ CIEES62939.2024.10811302. 

- Almulihi, A., Alharithi, F., Bourouis, S., Alroobaea, R., Pawar, Y., Bouguila, N., 2021. Oil spill detection in sar images using online extended variational learning of dirichlet process mixtures of gamma distributions. Remote Sens. 13 (15), 2991. https://doi. org/10.3390/rs13152991. 

- Alotaibi, E., Nassif, N., 2024. Artificial intelligence in environmental monitoring: Indepth analysis. Discov. Artif. Intell. 4 (1), 84. https://doi.org/10.1007/s44163-02400198-1. 

- Arnob, A.K.B., Mridha, M.F., Alfarhood, M., Che, Safran, M., 2025. A convolutional neural network-based segmentation approach for oil spill detection in satellite imagery with explainable ai. Earth Sci. Inf. 18 (3), 499. https://doi.org/10.1007/ s12145-025-01988-6. 

- Asif, Z., Chen, Z., An, C., Dong, J., 2022. Environmental impacts and challenges associated with oil spills on shorelines. J. Mar. Sci. Eng. 10 (6), 762. https://doi.org/ 10.3390/jmse10060762. 

- Bae, I., Hong, J., 2023. Survey on the developments of unmanned marine vehicles: intelligence and cooperation. Sensors (Basel) 23 (10), 4643. https://doi.org/ 10.3390/s23104643. 

- Bakhtiari, V., Piadeh, F., Chen, A.S., Behzadian, K., 2024. Stakeholder analysis in the application of cutting-edge digital visualisation technologies for urban flood risk management: a critical review. Expert Syst. Appl. 236, 121426. https://doi.org/ 10.1016/j.eswa.2023.121426. 

- Balogun, A.-L., Matori, A.-N., Toh Kiak, K.W., 2018. Developing an emergency response model for offshore oil spill disaster management using spatial decision support system (sdss). ISPRS Annals of the Photogrammetry. Remote Sens. Spat. Inf. Sci. IV3, 21–27. https://doi.org/10.5194/isprs-annals-iv-3-21-2018. 

- Balogun, A.-L., Yekeen, S.T., Pradhan, B., Althuwaynee, O.F., 2020. Spatio-temporal analysis of oil spill impact and recovery pattern of coastal vegetation and wetland using multispectral satellite landsat 8-oli imagery and machine learning models. Remote Sens. 12 (7), 1225. https://doi.org/10.3390/rs12071225. 

- Barbedo, J.G.A., 2022. A review on the use of computer vision and artificial intelligence for fish recognition, monitoring, and management. Fishes 7 (6), 335. https://doi. org/10.3390/fishes7060335. 

- Barberi, E., Chillemi, M., Cucinotta, F., Raffaele, M., Salmeri, F., Sfravara, F., 2025. Leveraging artificial intelligence for real-time risk detection in ship navigation. Appl. Sci. 15 (21), 11674. https://doi.org/10.3390/app152111674. 

- Baruque, B., Corchado, E., Mata, A., Corchado, J.M., 2010. A forecasting solution to the oil spill problem based on a hybrid intelligent system. Inf. Sci. 180 (10), 2029–2043. https://doi.org/10.1016/j.ins.2009.12.032. 

- Bayazitova, G., Anastasiadou, M., dos Santos, V.D., 2024. Oil and gas flow anomaly detection on offshore naturally flowing wells using deep neural networks. Geoenergy Sci. Eng. 242, 213240. https://doi.org/10.1016/j.geoen.2024.213240. 

- Bi, H., An, C., Mulligan, C.N., Zhang, K., Lee, K., Yue, R., 2022. Treatment of oiled beach sand using a green and responsive washing fluid with nonionic surfactant-modified nanoclay. J. Clean. Prod. 333. https://doi.org/10.1016/j.jclepro.2021.130122. 

- Bi, H., Mulligan, C.N., Ji, W., Yang, X., Lee, K., Zhang, B., Lyu, L., An, C., 2025a. Mechanistic insights into mitigating spilled oil on shorelines with biobased coatings: oil transport behavior and enhanced biodegradation dynamics. ACS ES&T Water 5 (9), 5057–5068. https://doi.org/10.1021/acsestwater.5c00132. 

- Bi, H., Mulligan, C.N., Lee, K., An, C., Wen, J., Yang, X., Lyu, L., Qu, Z., 2023. Preparation, characteristics, and performance of the microemulsion system in the removal of oil from beach sand. Mar. Pollut. Bull. 193, 115234. https://doi.org/ 10.1016/j.marpolbul.2023.115234. 

- Bi, H., Wang, Z., Yue, R., Sui, J., Mulligan, C.N., Lee, K., Pegau, S., Chen, Z., An, C., 2025b. Oil spills in coastal regions of the arctic and subarctic: environmental impacts, response tactics, and preparedness. Sci. Total Environ. 958, 178025. https://doi.org/10.1016/j.scitotenv.2024.178025. 

- Cai, Y., Chen, L., Zhuang, X., Zhang, B., 2024. Automated marine oil spill detection algorithm based on single-image generative adversarial network and yolo-v8 under small samples. Mar. Pollut. Bull. 203, 116475. https://doi.org/10.1016/j. marpolbul.2024.116475. 

- Chatterjee, S., Khan, P.W., Byun, Y.-C., 2024. Recent advances and applications of machine learning in the variable renewable energy sector. Energy Rep. 12, 5044–5065. https://doi.org/10.1016/j.egyr.2024.09.073. 

- Chen, X., Bose, N., Brito, M., Khan, F., Millar, G., Bulger, C., Zou, T., 2022a. Risk-based path planning for autonomous underwater vehicles in an oil spill environment. Ocean. Eng. 266, 113077. https://doi.org/10.1016/j.oceaneng.2022.113077. 

- Chen, Z., An, C., Elektorowicz, M., Tian, X., 2022b. Sources, behaviors, transformations, and environmental risks of organophosphate esters in the coastal environment: a 

   - review. Mar. Pollut. Bull. 180, 113779. https://doi.org/10.1016/j. marpolbul.2022.113779. 

- Chu, J., Liu, X., Zhang, Z., Zhang, Y., He, M., 2021. A novel method overcomeing overfitting of artificial neural network for accurate prediction: application on thermophysical property of natural gas. Case Stud. Therm. Eng. 28, 101406. https:// doi.org/10.1016/j.csite.2021.101406. 

- Ciappa, A., Costabile, S., 2014. Oil spill hazard assessment using a reverse trajectory method for the egadi marine protected area (central mediterranean sea). Mar. Pollut. Bull. 84 (1–2), 44–55. https://doi.org/10.1016/j.marpolbul.2014.05.044. 

- Cohen, T.A., Brook, A., Angel, D., 2024. A novel approach in oil spill detection, identification, and classification via multisource technologies and artificial intelligence. 2024 IEEE International Geoscience and Remote Sensing Symposium (IGARSS 2024). https://doi.org/10.1109/IGARSS53475.2024.10641173. 

- Cojocaru, C., Macoveanu, M., Cretescu, I., 2011. Peat-based sorbents for the removal of oil spills from water surface: application of artificial neural network modeling. Colloids Surf. A Physicochem. Eng. Asp. 384 (1–3), 675–684. https://doi.org/ 10.1016/j.colsurfa.2011.05.036. 

- Conceiç˜ao, M.R.A., de Mendonça, L.F.F., Lentini, C.A.D., da Cunha Lima, A.T., Lopes, J. M., de Vasconcelos, R.N., Gouveia, M.B., Porsani, M.J., 2021. Sar oil spill detection system through random forest classifiers. Remote Sens. 13 (11), 2044. https://doi. org/10.3390/rs13112044. 

- Cristea, V.-M., Baigulbayeva, M., Ongarbayev, Y., Smailov, N., Akkazin, Y., Ubaidulayeva, N., 2023. Prediction of oil sorption capacity on carbonized mixtures of shungite using artificial neural networks. Processes 11 (2), 518. https://doi.org/ 10.3390/pr11020518. 

- D'Affonseca, F.M., Vieira Reis, F.A.G., Corrˆea, C.V.d.S., Wieczorek, A., Giordano, L.d.C., Marques, M.L., Rodrigues, F.H., Costa, D.M., Kolya, A.d.A., Veiga, V.M., Santos, S.F., Magalh˜aes, L.M., Gatto, I.T., Riedel, P.S., 2023. Environmental sensitivity index maps to manage oil spill risks: a review and perspectives. Ocean Coast Manag. 239, 106590. https://doi.org/10.1016/j.ocecoaman.2023.106590. 

- Dangayach, R., Jeong, N., Demirel, E., Uzal, N., Fung, V., Chen, Y., 2025. Machine learning-aided inverse design and discovery of novel polymeric materials for membrane separation. Environ. Sci. Technol. 59 (2), 993–1012. https://doi.org/ 10.1021/acs.est.4c08298. 

- Davies, A.J., Hope, M.J., 2015. Bayesian inference-based environmental decision support systems for oil spill response strategy selection. Mar. Pollut. Bull. 96 (1–2), 87–102. https://doi.org/10.1016/j.marpolbul.2015.05.041. 

- De Dominicis, M., Pinardi, N., Zodiatis, G., Archetti, R., 2013b. Medslik-ii, a lagrangian marine surface oil spill model for short-term forecasting – part 2: numerical simulations and validations. Geosci. Model Dev. 6 (6), 1871–1888. https://doi.org/ 10.5194/gmd-6-1871-2013. 

- De Dominicis, M., Pinardi, N., Zodiatis, G., Lardner, R., 2013a. Medslik-ii, a lagrangian marine surface oil spill model for short-term forecasting – part 1: theory. Geosci. Model Dev. 6 (6), 1851–1869. https://doi.org/10.5194/gmd-6-1851-2013. 

- Delannoy, L., Longaretti, P.-Y., Murphy, D.J., Prados, E., 2021. Peak oil and the lowcarbon energy transition: a net-energy perspective. Appl. Energy 304, 117843. https://doi.org/10.1016/j.apenergy.2021.117843. 

- Demessie, S.F., Dile, Y.T., Bedadi, B., Tarkegn, T.G., Bayabil, H.K., Sintayehu, D.W., 2025. Assessing and projecting land use land cover changes using machine learning models in the guder watershed, Ethiopia. Environ. Chall. 18, 101074. https://doi. org/10.1016/j.envc.2024.101074. 

- Deng, Y., Adzigbli, L., 2018. Assessing the impact of oil spills on marine organisms. J. Oceanogr. Mar. Res. 6 (1), 1000179. https://doi.org/10.4172/25723103.1000179. 

- Dias, A., Mucha, A., Santos, T., Oliveira, A., Amaral, G., Ferreira, H., Martins, A., Almeida, J., Silva, E., 2024. Oil spill mitigation with a team of heterogeneous autonomous vehicles. J. Mar. Sci. Eng. 12 (8), 1281. https://doi.org/10.3390/ jmse12081281. 

- Dong, S., Feng, J., Gu, Z., Yin, K., Long, Y., 2025a. A review of artificial intelligence and remote sensing for marine oil spill detection, classification, and thickness estimation. Remote Sens. 17 (22), 3681. https://doi.org/10.3390/rs17223681. 

- Dong, S., Li, Y., Xie, M., Zhang, Z., Wang, J., 2025b. Enhancing marine oil spill detection through dynamic adaptive knowledge distillation with spectral mask superpixel. Mar. Pollut. Bull. 219, 118270. https://doi.org/10.1016/j.marpolbul.2025.118270. 

- Du, K., Ma, Y., Li, Z., Jiang, Z., Liu, R., Yang, J., 2025a. Qosm-u2canet: a deep learning framework for normalized oil spill thickness and concentration mapping using multispectral satellite imagery. ISPRS J. Photogrammetry Remote Sens. 228, 420–437. https://doi.org/10.1016/j.isprsjprs.2025.07.029. 

- Du, K., Ma, Y., Li, Z., Liu, R., Jiang, Z., Yang, J., 2025b. Ms3osd: a novel deep learning approach for oil spills detection using optical satellite multisensor spatial-spectral fusion images. IEEE J. Sel. Top. Appl. Earth Obs. Remote Sens. 18, 8617–8629. https://doi.org/10.1109/jstars.2025.3550421. 

- Durlik, I., Miller, T., Kostecka, E., Kozlovska, P., Sl<sup>´</sup> ączka, W., 2025. Enhancing safety in autonomous maritime transportation systems with real-time ai agents. Appl. Sci. 15 (9), 4986. https://doi.org/10.3390/app15094986. 

- Eide, M.S., Endresen, O., Brett, P.O., Ervik, J.L., Roang, K., 2007. Intelligent ship traffic monitoring for oil spill prevention: risk based decision support building on ais. Mar. Pollut. Bull. 54 (2), 145–148. https://doi.org/10.1016/j.marpolbul.2006.11.004. 

- Elgarahy, A.M., Eloffy, M.G., Arunkumar, P., Zirari, M., Ali, M.M., Al-Khatib, L.A., Alqahtani, M.D., Elwakeel, K.Z., 2025. Sustainable biopolymer-based materials for oil spill remediation: artificial intelligence integration and technoeconomic insights - a review. Int. J. Biol. Macromol. 332 (Pt 1), 148310. https://doi.org/10.1016/j. ijbiomac.2025.148310. 

- Elgharbi, S.E., Iturralde, M., Dupuis, Y., Gaugue, A., 2025. Maritime monitoring through lorawan: resilient decentralised mesh networks for enhanced data transmission. Comput. Commun. 241, 108276. https://doi.org/10.1016/j.comcom.2025.108276. 


Elmakis, O., Degani, A., 2023. Usv port oil spill cleanup using hybrid multi-destination rlcpp. IEEE Access 11, 122722–122735. https://doi.org/10.1109/ access.2023.3327559. 

- Fang, J., Cheng, X., Gai, H., Lin, S., Lou, H., 2023. Development of machine learning algorithms for predicting internal corrosion of crude oil and natural gas pipelines. Comput. Chem. Eng. 177, 108358. https://doi.org/10.1016/j. compchemeng.2023.108358. 

- Fingas, M., Brown, C.E., 2017. A review of oil spill remote sensing. Sensors 18 (1), 91. https://doi.org/10.3390/s18010091. 

- French-McCay, D., Crowley, D., Rowe, J.J., Bock, M., Robinson, H., Wenning, R., Walker, A.H., Joeckel, J., Nedwed, T.J., Parkerton, T.F., 2018. Comparative risk assessment of spill response options for a deepwater oil well blowout: part 1. Oil spill modeling. Mar. Pollut. Bull. 133, 1001–1015. https://doi.org/10.1016/j. marpolbul.2018.05.042. 

- Ganesh Shankar, G., 2024. Artificial intelligence for predictive maintenance in oil and gas operations. World J. Adv. Res. Rev. 23 (3), 1228–1233. https://doi.org/ 10.30574/wjarr.2024.23.3.2721. 

- García-Sanchez, G., Mancho, A.M., Ramos, A.G., Coca, J., Wiggins, S., 2022. Structured ´ pathways in the turbulence organizing recent oil spill events in the eastern mediterranean. Sci. Rep. 12 (1), 3662. https://doi.org/10.1038/s41598-022-07350w. 

- Garcia-Pineda, O., Staples, G., Jones, C.E., Hu, C., Holt, B., Kourafalou, V., Graettinger, G., DiPinto, L., Ramirez, E., Streett, D., Cho, J., Swayze, G.A., Sun, S., Garcia, D., Haces-Garcia, F., 2020. Classification of oil spill by thicknesses using multiple remote sensors. Remote Sens. Environ. 236, 111421. https://doi.org/ 10.1016/j.rse.2019.111421. 

- Genovez, P.C., Ponte, F.F.d.A., Matias,<sup>´</sup> I.d.O., Torres, S.B., Beisl, C.H., Mano, M.F., Silva, G.M.A., Miranda, F.P.d., 2023. Development and application of predictive models to distinguish seepage slicks from oil spills on sea surfaces employing sar sensors and artificial intelligence: geometric patterns recognition under a transfer learning approach. Remote Sens. 15 (6), 1496. https://doi.org/10.3390/ rs15061496. 

- Gonzalez-Reolid, I., Molina-Molina, J.C., Guerrero-Gonzalez, A., Ortiz, F.J., Alonso, D., 2018. An autonomous solar-powered marine robotic observatory for permanent monitoring of large areas of shallow water. Sensors (Basel) 18 (10), 3497. https:// doi.org/10.3390/s18103497. 

- Greene, S., Jia, H., Rubio-Domingo, G., 2020. Well-to-tank carbon emissions from crude oil maritime transportation. Transp. Res., Part D Transp. Environ. 88, 102587. https://doi.org/10.1016/j.trd.2020.102587. 

- Guan, B., Ning, S., Ding, X., Kang, D., Song, J., Yuan, H., 2023. Comprehensive study of algal blooms variation in jiaozhou bay based on google earth engine and deep learning. Sci. Rep. 13 (1), 13930. https://doi.org/10.1038/s41598-023-41138-w. 

- Hajji, A.L., Lucas, K.N., 2024. Anthropogenic stressors and the marine environment: from sources and impacts to solutions and mitigation. Mar. Pollut. Bull. 205, 116557. https://doi.org/10.1016/j.marpolbul.2024.116557. 

- Hamza, A., Ali, Z., Dudley, S., Saleem, K., Uneeb, M., Christofides, N., 2025. A multistage review framework for ai-driven predictive maintenance and fault diagnosis in photovoltaic systems. Appl. Energy 393, 126108. https://doi.org/10.1016/j. apenergy.2025.126108. 

- He, F., Xu, Y., Zheng, P., Liu, G., Zhao, D., 2025. Analysis of emergency cooperative strategies in marine oil spill response: a stochastic evolutionary game approach. Sustainability 17 (11), 4920. https://doi.org/10.3390/su17114920. 

- Hettithanthri, O., Nguyen, T.B.T., Fiedler, T., Phan, C., Vithanage, M., Pallewatta, S., Nguyen, T.M.L., Nguyen, P.Q.A., Bolan, N., 2024. A review of oil spill dynamics: statistics, impacts, countermeasures, and weathering behaviors. Asia Pac. J. Chem. Eng. 19 (6), e3128. https://doi.org/10.1002/apj.3128. 

- Hu, C., Lu, Y., Sun, S., Liu, Y., 2021. Optical remote sensing of oil spills in the ocean: what is really possible? J.Remote Sens. 2021. https://doi.org/10.34133/2021/ 9141902. 

- Huang, K., Nie, W., Luo, N., 2020. Scenario-based marine oil spill emergency response using hybrid deep reinforcement learning and case-based reasoning. Appl. Sci. 10 (15), 5269. https://doi.org/10.3390/app10155269. 

- Huby, A.A., Sagban, R., Alubady, R., 2022. Oil spill detection based on machine learning and deep learning. A Review 2022 5th International Conference on Engineering Technology and its Applications (IICETA). https://doi.org/10.1109/ IICETA54559.2022.9888651. 

- Hwang, J., Bose, N., Nguyen, H.D., Williams, G., 2020. Acoustic search and detection of oil plumes using an autonomous underwater vehicle. J. Mar. Sci. Eng. 8 (8), 618. https://doi.org/10.3390/jmse8080618. 

- Iravani, R., Biagi, M., Laforest, S., Lee, K., Isaacman, L., Chen, Z., An, C., 2025. Protecting shorelines in canadian indigenous communities: environmental challenges, policy interventions, and mitigation technologies. Mar. Pollut. Bull. 219, 118310. https:// doi.org/10.1016/j.marpolbul.2025.118310. 

- ITOPF, 2025. Oil Tanker Spill Statistics 2024. 

- Jafarzadeh, H., Mahdianpari, M., Homayouni, S., Mohammadimanesh, F., Dabboor, M., 2021. Oil spill detection from synthetic aperture radar earth observations: a metaanalysis and comprehensive review. GIScience Remote Sens. 58 (7), 1022–1051. https://doi.org/10.1080/15481603.2021.1952542. 

- Jayarathna, M.D., Rajapaksha, A.U., Samarasekara, S., Vithanage, M., 2024. Oil spill response: existing technologies, prospects and perspectives. CleanMat 1 (1), 78–96. https://doi.org/10.1002/clem.17. 

- Jeong, J., Choi, J., 2022. Artificial intelligence-based toxicity prediction of environmental chemicals: future directions for chemical management applications. Environ. Sci. Technol. 56 (12), 7532–7543. https://doi.org/10.1021/acs. est.1c07413. 

- Ji, H., Xie, W., Liu, W., Liu, X., Zhao, D., 2020. Sorption of dispersed petroleum hydrocarbons by activated charcoals: effects of oil dispersants. Environ. Pollut. 256, 113416. https://doi.org/10.1016/j.envpol.2019.113416. 

- Jiang, Q., Ji, M., Wang, J., Sun, P., 2023. Remote sensing methods for striped marine oil spill detection in narrow ship channels. Ocean. Eng. 289, 116162. https://doi.org/ 10.1016/j.oceaneng.2023.116162. 

- Jiao, S., Katz, L.E., Shell, M.S., 2022. Inverse design of pore wall chemistry to control solute transport and selectivity. ACS Cent. Sci. 8 (12), 1609–1617. https://doi.org/ 10.1021/acscentsci.2c01011. 

- Jin, X., Ray, A., 2013. Navigation of autonomous vehicles for oil spill cleaning in dynamic and uncertain environments. Int. J. Control 87 (4), 787–801. https://doi. org/10.1080/00207179.2013.858829. 

- Johann, S., Gossen, M., Behnisch, P.A., Hollert, H., Seiler, T.B., 2020. Combining different in vitro bioassays to evaluate genotoxicity of water-accommodated fractions from petroleum products. Toxics 8 (2), 45. https://doi.org/10.3390/ toxics8020045. 

- Kalogirou, E., Christofi, K., Makri, D., Iqbal, M.A., La Pegna, V., Tzouvaras, M., Mettas, C., Hadjimitsis, D., 2025. Oil spill detection using convolutional neural networks and sentinel-1 sar imagery. The International Archives of the Photogrammetry. Remote Sens. Spat. Inf. Sci. 757–764. https://doi.org/10.5194/ isprs-archives-XLVIII-G-2025-757-2025. XLVIII-G-2025. 

- Kampouris, K., Vervatis, V., Karagiorgos, J., Sofianos, S., 2021. Oil spill model uncertainty quantification using an atmospheric ensemble. Ocean Sci. 17 (4), 919–934. https://doi.org/10.5194/os-17-919-2021. 

- Kang, X., Wang, Z., Duan, P., Wei, X., 2022. The potential of hyperspectral image classification for oil spill mapping. IEEE Trans. Geosci. Rem. Sens. 60, 1–15. https:// doi.org/10.1109/TGRS.2022.3205966. 

- Kaviri, S., Tahsiri, A., Taghirad, H.D., 2019. Coverage control of multi-robot system for dynamic cleaning of oil spills. In: 2019 7th International Conference on Robotics and Mechatronics (ICRoM). https://doi.org/10.1109/ICRoM48714.2019.9071805. 

- Keramea, P., Spanoudaki, K., Zodiatis, G., Gikas, G., Sylaios, G., 2021. Oil spill modeling: a critical review on current trends, perspectives, and challenges. J. Mar. Sci. Eng. 9 (2), 181. https://doi.org/10.3390/jmse9020181. 

- Kim, J.J., Adamowski, J., Park, S., Lim, K., Jeong, H., 2025. A systematic study of hyperparameter tuning for environmental text classification: implications for environmental management. J. Environ. Inform. 46 (1), 41–56. https://doi.org/ 10.3808/jei.202500545. 

- Kovari, A., 2024. Ai for decision support: balancing accuracy, transparency, and trust across sectors. Information 15 (11), 725. https://doi.org/10.3390/info15110725. 

- Kumar, S., Gopi, T., Harikeerthana, N., Gupta, M.K., Gaur, V., Krolczyk, G.M., Wu, C., 2023. Machine learning techniques in additive manufacturing: a state of the art review on design, processes and production control. J. Intell. Manuf. 34 (1), 21–55. https://doi.org/10.1007/s10845-022-02029-5. 

- Kwok, R.K., Miller, A.K., Gam, K.B., Curry, M.D., Ramsey, S.K., Blair, A., Engel, L.S., Sandler, D.P., 2019. Developing large-scale research in response to an oil spill disaster: a case study. Curr. Environ. Health Rep. 6 (3), 174–187. https://doi.org/ 10.1007/s40572-019-00241-9. 

- Le, Q.D., Pham, D., Bui, T.A.E., Nguyen, L.H., Nguyen, P.Q.P., Dang, T.N., 2025. Ensemble machine learning model prediction and metaheuristic optimisation of oil spills using organic absorbents: supporting sustainable maritime. Pol. Marit. Res. 32 (2), 141–155. https://doi.org/10.2478/pomr-2025-0029. 

- Lee, J., Park, H., 2024. Prediction of the marine spreading of low sulfur fuel oil using the long short-term memory model trained with three-phase numerical simulations. Mar. Pollut. Bull. 202, 116356. https://doi.org/10.1016/j.marpolbul.2024.116356. 

- Li, K., Yu, H., Xu, Y., Luo, X., 2022a. Detection of oil spills based on gray level cooccurrence matrix and support vector machine. Front. Environ. Sci. 10. https://doi. org/10.3389/fenvs.2022.1049880. 

- Li, K., Yu, H., Xu, Y., Luo, X., 2022b. Scheduling optimization of offshore oil spill cleaning materials considering multiple accident sites and multiple oil types. Sustainability 14 (16), 10047. https://doi.org/10.3390/su141610047. 

- Li, X., Qu, Z., Wang, S., Kong, D., 2024. Quantitative analysis of emulsified oil spill based on multi-source spectral data fusion. 2024 Academic Conference of China Instrument and Control Society (ACCIS). https://doi.org/10.1109/ ACCIS62068.2024.10948622. 

- Liu, Q., Huang, T., Dong, Y., Xiang, W., 2025a. Enhancing oil spill detection with controlled random sampling: a multimodal fusion approach using sar and hsi imagery. Remote Sens. Appl.: Soc. Environ. 38, 101601. https://doi.org/10.1016/j. rsase.2025.101601. 

- Liu, Q.C., Qin, Y.C., Gao, H.B., Wang, Y., Lv, C., Cai, Y.F., Chen, L., 2025b. Predicting fine spatial-temporal scale bus emissions using graph embedding deep learning model. J. Environ. Inform. 45 (2), 103–117. https://doi.org/10.3808/jei.202500534. 

- Liubartseva, S., Coppini, G., Pinardi, N., De Dominicis, M., Lecci, R., Turrisi, G., Cretì, S., Martinelli, S., Agostini, P., Marra, P., Palermo, F., 2016. Decision support system for emergency management of oil spill accidents in the mediterranean sea. Nat. Hazards Earth Syst. Sci. 16 (8), 2009–2020. https://doi.org/10.5194/nhess-16-2009-2016. 

- Llavero-Pasquina, M., Navas, G., Cantoni, R., Martínez-Alier, J., 2024. The political ecology of oil and gas corporations: totalenergies and post-colonial exploitation to concentrate energy in industrial economies. Energy Res. Social Sci. 109, 103434. https://doi.org/10.1016/j.erss.2024.103434. 

- Lopez, J.R.B., Quintero, J.M.C., Carracedo, K.S., Quintero, E.C., Zodiatis, G., 2021. ´ Decision support tools for managing marine hydrocarbon spills in island environments. In: Marine Hydrocarbon Spill Assessments, pp. 289–356. https://doi. org/10.1016/B978-0-12-819354-9.00008-9 ch.9. 

- Luo, S., Kim, J., Min, B.-C., 2022. Asymptotic boundary shrink control with multirobot systems. IEEE Trans. Syst. Man Cybern. Syst. 52 (1), 591–605. https://doi.org/ 10.1109/tsmc.2020.3003824. 


- Lyu, C., Zhu, Y., Zhang, G., Li, H., 2024. Phenanthrene removal from soil washing eluent by _Bacillus subtilis_ embedded in alginate-carboxymethyl cellulose-diatomite beads. Environ. Technol. 45 (21), 4255–4265. https://doi.org/10.1080/ 09593330.2023.2246106. 

- Ma, S., Liu, C., Harvey, C.M., Bucknall, R., Liu, Y., 2025. Adaptive informative path planning for active reconstruction of spatio-temporal water pollution dispersion using unmanned surface vehicles. Appl. Ocean Res. 156, 104458. https://doi.org/ 10.1016/j.apor.2025.104458. 

- Ma, X., Wang, Z., Liu, Y., 2024. Ecological risk assessment of a coastal area using multisource remote sensing images and in-situ sample data. Ecol. Indic. 158, 111470. https://doi.org/10.1016/j.ecolind.2023.111470. 

- Ma, X., Xu, J., Pan, J., Yang, J., Wu, P., Meng, X., 2023. Detection of marine oil spills from radar satellite images for the coastal ecological risk assessment. J. Environ. Manag. 325 (Pt B), 116637. https://doi.org/10.1016/j.jenvman.2022.116637. 

- Mahmoudi Ghara, F., Shokouhi, S.B., Akbarizadeh, G., 2022. A new technique for segmentation of the oil spills from synthetic-aperture radar images using convolutional neural network. IEEE J. Sel. Top. Appl. Earth Obs. Remote Sens. 15, 8834–8844. https://doi.org/10.1109/jstars.2022.3213768. 

- Malashin, I., Martysyuk, D., Tynchenko, V., Gantimurov, A., Semikolenov, A., Nelyub, V., Borodulin, A., 2024. Machine learning-based process optimization in biopolymer manufacturing: a review. Polymers 16 (23), 3368. https://doi.org/10.3390/ polym16233368. 

- Mazumder, R.K., Salman, A.M., Li, Y., 2021. Failure risk analysis of pipelines using datadriven machine learning algorithms. Struct. Saf. 89, 102047. https://doi.org/ 10.1016/j.strusafe.2020.102047. 

- Mohammadiun, S., Hu, G., Gharahbagh, A.A., Li, J., Hewage, K., Sadiq, R., 2022. Evaluation of machine learning techniques to select marine oil spill response methods under small-sized dataset conditions. J. Hazard. Mater. 436, 129282. https://doi.org/10.1016/j.jhazmat.2022.129282. 

- Monson, D.H., Doak, D.F., Ballachey, B.E., Johnson, A., Bodkin, J.L., 2000. Long-term impacts of the exxon valdez oil spill on sea otters, assessed through age-dependent mortality patterns. Proc. Natl. Acad. Sci. USA 97 (12), 6562–6567. https://doi.org/ 10.1073/pnas.120163397. 

- Monteiro Martins, L., Coz, E., Maucort-Boulch, D., Hacid, M.-S., 2025. Machine learning with environmental predictors to forecast hospital visits and admissions: a systematic review. Environ. Syst. Res. 14 (1), 12. https://doi.org/10.1186/s40068025-00401-x. 

- Morain, A., Nedd, R., Poole, K., Hawkins, L., Jones, M., Washington, B., Anandhi, A., 2025. Artificial intelligence application in nonpoint source pollution management: a status update. Sustainability 17 (13), 5810. https://doi.org/10.3390/su17135810. 

- Motiee, H., Ahrari, S., Motiee, S., McBean, E., 2025. Assessment of climate change with remote sensing data on snow and ice cover in the rocky mountains glaciers. J. Environ. Inform 46 (1), 1–13. https://doi.org/10.3808/jei.202500544. 

- Moussa, A., Ezzeldin, M., El-Dakhakhni, W., 2025. Machine learning and optimization strategies for infrastructure projects risk management. Construct. Manag. Econ. 43 (8), 557–582. https://doi.org/10.1080/01446193.2025.2479764. 

- Murray, B., Perera, L.P., 2021. An ais-based deep learning framework for regional ship behavior prediction. Reliab. Eng. Syst. Saf. 215, 107819. https://doi.org/10.1016/j. ress.2021.107819. 

- Naz, S., Iqbal, M.F., Mahmood, I., Allam, M., 2021. Marine oil spill detection using synthetic aperture radar over indian ocean. Mar. Pollut. Bull. 162, 111921. https:// doi.org/10.1016/j.marpolbul.2020.111921. 

- Ning, J., Pang, S., Arifin, Z., Zhang, Y., Epa, U.P.K., Qu, M., Zhao, J., Zhen, F., Chowdhury, A., Guo, R., Deng, Y., Zhang, H., 2024. The diversity of artificial intelligence applications in marine pollution: a systematic literature review. J. Mar. Sci. Eng. 12 (7), 1181. https://doi.org/10.3390/jmse12071181. 

- Nordam, T., Nepstad, R., Litzler, E., Rohrs, J., 2019. On the use of random walk schemes ¨ in oil spill modelling. Mar. Pollut. Bull. 146, 631–638. https://doi.org/10.1016/j. marpolbul.2019.07.002. 

- O'Farrell, J., O'Fionnag´ain, D., Babatunde, A.O., Geever, M., Codyre, P., Murphy, P.C., Spillane, C., Golden, A., 2025. Quantifying the impact of crude oil spills on the mangrove ecosystem in the niger delta using ai and earth observation. Remote Sens. 17 (3), 358. https://doi.org/10.3390/rs17030358. 

- Obasi, I.C., Cheng, P., Varianou-Mikellidou, C., Dimopoulos, C., Boustras, G., 2026. Machine learning for occupational accident analysis: applications, challenges, and future directions. J. Saf. Sci. Resil. 7 (1), 100250. https://doi.org/10.1016/j. jnlssr.2025.100250. 

- Obasi, I.C., Benson, C., 2023. Evaluating the effectiveness of machine learning techniques in forecasting the severity of traffic accidents. Heliyon 9 (8), e18812. https://doi.org/10.1016/j.heliyon.2023.e18812. 

- Odonkor, P., Ball, Z., Chowdhury, S., 2019. Distributed operation of collaborating unmanned aerial vehicles for time-sensitive oil spill mapping. Swarm Evol. Comput. 46, 52–68. https://doi.org/10.1016/j.swevo.2019.01.005. 

- Okafor, C.C., Otunomo, F.A., Nnadi, V.E., Nzekwe, C.A., Nwoye, A.V., Ajaero, C.C., 2025. Artificial intelligence in environmental research: bibliometric, text mining and content analysis. Discov. Artif. Intell. 5 (1), 124. https://doi.org/10.1007/s44163025-00289-7. 

- Onyeka Virginia, E., Godwin Ekunke, O., Saadatu Maigana, S., Courage Humphrey, O., Muhammad Liman, A., Mustapha Ali, A., Isa, E., 2025. A review of modern technologies and best practices for oil spill containment and response. World J. Adv. Res. Rev. 25 (3), 2117–2128. https://doi.org/10.30574/wjarr.2025.25.3.0933. 

- Park, M., Nam, B.W., 2025. Optimal coverage path planning for unmanned surface vehicles using flexible formation tracking control. J. Ocean Eng. Technol. 39 (3), 287–298. https://doi.org/10.26748/KSOE.2025.010. 

- Patowary, R., Devi, A., Mukherjee, A.K., 2023. Advanced bioremediation by an amalgamation of nanotechnology and modern artificial intelligence for efficient 

restoration of crude petroleum oil-contaminated sites: a prospective study. Environ. Sci. Pollut. Res. Int. 30 (30), 74459–74484. https://doi.org/10.1007/s11356-02327698-4. 

- Perhar, G., Arhonditsis, G.B., 2014. Aquatic ecosystem dynamics following petroleum hydrocarbon perturbations: a review of the current state of knowledge. J. Great Lake. Res. 40, 56–72. https://doi.org/10.1016/j.jglr.2014.05.013. 

- Premasudha, M., Bhumi Reddy, S.R., Lee, Y.J., Panigrahi, B.B., Cho, K.K., Nagireddy Gari, S.R., 2020. Using artificial neural networks to model and interpret electrospun polysaccharide (hylon vii starch) nanofiber diameter. J. Appl. Polym. Sci. 138 (11), 50014. https://doi.org/10.1002/app.50014. 

- Purohit, B.K., Tewari, S., Prasad, K.S.N.V., Talari, V.K., Pandey, N., Choudhury, P., Panda, S.S., 2024. Marine oil spill clean-up: a review on technologies with recent trends and challenges. Reg. Stud. Mar. Sci. 80, 103876. https://doi.org/10.1016/j. rsma.2024.103876. 

- Rahmani Dabbagh, S., Ozcan, O., Tasoglu, S., 2022. Machine learning-enabled optimization of extrusion-based 3d printing. Methods 206, 27–40. https://doi.org/ 10.1016/j.ymeth.2022.08.002. 

- Safonova, A., Ghazaryan, G., Stiller, S., Main-Knorn, M., Nendel, C., Ryo, M., 2023. Ten deep learning techniques to address small data problems with remote sensing. Int. J. Appl. Earth Obs. Geoinf. 125, 103569. https://doi.org/10.1016/j.jag.2023.103569. 

- Saleh, O., Otim, F.N., Otim, O., 2023. Application of supervised learning classification modeling for predicting benthic sediment toxicity in the southern california bight: a test of concept. Sci. Total Environ. 901, 165946. https://doi.org/10.1016/j. scitotenv.2023.165946. 

- Salhi, A., Alshamrani, R., Althbiti, A., Ismail, A., Abd-ElRahman, M., Hassan, B.M., 2025. Optimizing high dimensional data classification with a hybrid ai driven feature selection framework and machine learning schema. Sci. Rep. 15 (1), 35038. https:// doi.org/10.1038/s41598-025-08699-4. 

- Sarma, S., Verma, A.K., Phadkule, S.S., Saharia, M., 2022. Towards an interpretable machine learning model for electrospun polyvinylidene fluoride (pvdf) fiber properties. Comput. Mater. Sci. 213, 111661. https://doi.org/10.1016/j. commatsci.2022.111661. 

- Sevgili, C., Fiskin, R., Cakir, E., 2022. A data-driven bayesian network model for oil spill occurrence prediction using tankship accidents. J. Clean. Prod. 370, 133478. https://doi.org/10.1016/j.jclepro.2022.133478. 

- Sezer, S.I., Elidolu, G., Akyuz, E., Arslan, O., 2023. A quantified risk analysis for oil spill during crude oil loading operation on tanker ship under improved z-number based bayesian network approach. Mar. Pollut. Bull. 197, 115796. https://doi.org/ 10.1016/j.marpolbul.2023.115796. 

- Sharma, K., Shah, G., Singhal, K., Soni, V., 2024. Comprehensive insights into the impact of oil pollution on the environment. Reg. Stud. Mar. Sci. 74, 103516. https://doi. org/10.1016/j.rsma.2024.103516. 

- Sigmund, G., Gharasoo, M., Huffer, T., Hofmann, T., 2020. Deep learning neural network approach for predicting the sorption of ionizable and polar organic pollutants to a wide range of carbonaceous materials. Environ. Sci. Technol. 54 (7), 4583–4591. https://doi.org/10.1021/acs.est.9b06287. 

- Simion, D., Postolache, F., Fleac˘a, B., Fleaca, E., 2024. Ai-driven predictive maintenance ˘ in modern maritime transport—enhancing operational efficiency and reliability. Appl. Sci. 14 (20), 9439. https://doi.org/10.3390/app14209439. 

- Singh, K.P., Gupta, S., Rai, P., 2013. Predicting acute aquatic toxicity of structurally diverse chemicals in fish using artificial intelligence approaches. Ecotoxicol. Environ. Saf. 95, 221–233. https://doi.org/10.1016/j.ecoenv.2013.05.017. 

- Skrobek, D., Krzywanski, J., Sosnowski, M., Kulakowska, A., Zylka, A., Grabowska, K., Ciesielska, K., Nowak, W., 2020. Prediction of sorption processes using the deep learning methods (long short-term memory). Energies 13 (24), 6601. https://doi. org/10.3390/en13246601. 

- Song, M., Hu, W., Liu, S., Chen, S., Fu, X., Zhang, J., Li, W., Xu, Y., 2024. Developing an artificial intelligence-based method for predicting the trajectory of surface drifting buoys using a hybrid multi-layer neural Network model. J. Mar. Sci. Eng. 12 (6), 958. https://doi.org/10.3390/jmse12060958. 

- Spanoudaki, K., Kozyrakis, G., Metheniti, V., Parasyris, A., Kampanis, N., 2023. The Cretan Sea Oil Spill Digital Twin Pilot for the Iliad Digital Twin of the Ocean, EGU2vols. 3–11561. EGU General Assembly Conference Abstracts. https://doi.org/ 10.5194/egusphere-egu23-11561. 

- Srinivasan, A., Babu, V.J., 2025. Review of applications of artificial intelligence and drones in oil pollution in seawater. J. Comput. Commun. 13 (4), 17–34. https://doi. org/10.4236/jcc.2025.134002. 

- Surianarayanan, C., Chelliah, P.R., 2023. Integration of the internet of things and cloud. Int. J. Cloud Appl. Comput. (IJCAC) 13 (1), 1–30. https://doi.org/10.4018/ ijcac.325624. 

- Tamascelli, N., Solini, R., Paltrinieri, N., Cozzani, V., 2022. Learning from major accidents: a machine learning approach. Comput. Chem. Eng. 162, 107786. https:// doi.org/10.1016/j.compchemeng.2022.107786. 

- Thanopoulou, H., Patera, A., Moresis, O., Georgoulis, G., Lioumi, V., Kanavos, A., Papadimitriou, O., Zervakis, V., Dagkinis, I., 2023. Supporting informed public reactions to shipping incidents with oil spill potential: an innovative electronic platform. Sustainability 15 (20), 15035. https://doi.org/10.3390/su152015035. 

- Tian, X., Wang, B., Wang, Z., Wan, S., Peng, H., An, C., 2025. Unraveling energy demand in battery electric bus operations through an explainable machine learning approach using real-world cold-climate data. Energy 340, 139256. https://doi.org/10.1016/j. energy.2025.139256. 

- Trong, N.T., Le Tan, P.H., Ngoc, D.N., Huy, B.L., Thanh, D.T., Van, N.T., 2024. Optimizing the synthesis conditions of aerogels based on cellulose fiber extracted from rambutan peel using response surface methodology. AIMS Environ. Sci. 11 (4), 576–592. https://doi.org/10.3934/environsci.2024028. 


Ucar, A., Karakose, M., Kırımça, N., 2024. Artificial intelligence for predictive maintenance applications: key components, trustworthiness, and future trends. Appl. Sci. 14 (2), 898. https://doi.org/10.3390/app14020898. 

- Uncuoglu, E., Citakoglu, H., Latifoglu, L., Bayram, S., Laman, M., Ilkentapar, M., Oner, A. A., 2022. Comparison of neural network, gaussian regression, support vector machine, long short-term memory, multi-gene genetic programming, and m5 trees methods for solving civil engineering problems. Appl. Soft Comput. 129, 109623. https://doi.org/10.1016/j.asoc.2022.109623. 

- Vasconcelos, R.N., Lima, A.T.C., Lentini, C.A.D., Miranda, J.G.V., de Mendonça, L.F.F., Costa, D.P., Duverger, S.G., Cambui, E.C.B., 2025. Trends in oil spill modeling: a review of the literature. Water 17 (15), 2300. https://doi.org/10.3390/w17152300. 

- Vinoth Kumar, S., Jayaparvathy, R., Priyanka, B.N., 2020. Efficient path planning of auvs for container ship oil spill detection in coastal areas. Ocean. Eng. 217, 107932. https://doi.org/10.1016/j.oceaneng.2020.107932. 

- Wahono, T., Purniawan, A., Mukhlash, I., Putri, E.R.M., 2025. Risk-based asset integrity management in the oil and gas industry from traditional to machine learning approaches: a systematic review. Results Eng. 28, 107287. https://doi.org/10.1016/ j.rineng.2025.107287. 

- Walker, R.C., Hyer, A.P., Guo, H., Ferri, J.K., 2023. Silica aerogel synthesis/ process–property predictions by machine learning. Chem. Mater. 35 (13), 4897–4910. https://doi.org/10.1021/acs.chemmater.2c03459. 

- Wan, S., Nik-Bakht, M., Ng, K.T.W., Tian, X., An, C., Sun, H., Yue, R., 2024. Insights into the urban municipal solid waste generation during the covid-19 pandemic from machine learning analysis. Sustain. Cities Soc. 100, 105044. https://doi.org/ 10.1016/j.scs.2023.105044. 

- Wan, S., Yang, X., Chen, X., Qu, Z., An, C., Zhang, B., Lee, K., Bi, H., 2022. Emerging marine pollution from container ship accidents: risk characteristics, response strategies, and regulation advancements. J. Clean. Prod. 376, 134266. https://doi. org/10.1016/j.jclepro.2022.134266. 

- Wang, B., Cai, J., Liu, C., Yang, J., Ding, X., 2020. Harnessing a novel machine-learningassisted evolutionary algorithm to co-optimize three characteristics of an electrospun oil sorbent. ACS Appl. Mater. Interfaces 12 (38), 42842–42849. https:// doi.org/10.1021/acsami.0c11667. 

- Wang, F., Pang, Y., Bai, L., Godin, M., 2025a. Researching the landscape of predictive emissions monitoring system: a review of literature and technology trends. Environ. Syst. Res. 14 (1), 11. https://doi.org/10.1186/s40068-025-00403-9. 

- Wang, M., Su, X., Song, H., Wang, Y., Yang, X., 2025b. Enhancing predictive maintenance strategies for oil and gas equipment through ensemble learning modeling. J. Pet. Explor. Prod. Technol. 15 (3), 46. https://doi.org/10.1007/ s13202-025-01931-x. 

- Wang, N., Dong, G., Qiao, R., Yin, X., Lin, S., 2024. Bringing artificial intelligence (ai) into environmental toxicology studies: a perspective of ai-enabled zebrafish highthroughput screening. Environ. Sci. Technol. 58 (22), 9487–9499. https://doi.org/ 10.1021/acs.est.4c00480. 

- Wang, Z., Huang, G., Chen, Z., An, C., 2025c. Accidents involving lithium-ion batteries in non-application stages: incident characteristics, environmental impacts, and response strategies. BMC Chem. 19 (1), 94. https://doi.org/10.1186/s13065-02501445-x. 

- Wang, Z., Li, S., Jin, Z., Li, Z., Liu, Q., Zhang, K., 2023. Oil and gas pathway to net-zero: review and outlook. Energy Strategy Rev. 45, 101048. https://doi.org/10.1016/j. esr.2022.101048. 

- Wang, Z., Lu, Y., Medraj, M., Li, B., An, C., 2025d. Hydrogen storage systems at ports for enhanced safety and sustainability: a review. Mar. Dev. 3 (1), 16. https://doi.org/ 10.1007/s44312-025-00061-6. 

- Wen, Y., Fashiar Rahman, M., Xu, H., Tseng, T.-L.B., 2022. Recent advances and trends of predictive maintenance from data-driven machine prognostics perspective. Meas. 187, 110276. https://doi.org/10.1016/j.measurement.2021.110276. 

- Wu, J., Cheng, L., Chu, S., Song, Y., 2024. An autonomous coverage path planning algorithm for maritime search and rescue of persons-in-water based on deep reinforcement learning. Ocean. Eng. 291, 116403. https://doi.org/10.1016/j. oceaneng.2023.116403. 

- Wu, T., Zhang, J., Yan, Q., Wang, J., Yang, H., 2025. Machine learning in the design and performance prediction of organic framework membranes: methodologies, applications, and industrial prospects. Membranes 15 (6), 178. https://doi.org/ 10.3390/membranes15060178. 

- Xie, J., Lan, R., Zhang, L., Yu, J., Liu, X., You, Z., Yang, F., Lin, T., 2025. Global occurrence, food web transfer, and human health risks of polycyclic aromatic hydrocarbons in biota. Sci. Total Environ. 958, 177969. https://doi.org/10.1016/j. scitotenv.2024.177969. 

- Xiong, Y., Wang, S., Tian, H., Liu, G., Shan, Z., Yin, Y., Tao, J., Ye, H., Tang, Y., 2025. Spatiotemporal meta-reinforcement learning for multi-usv adversarial games using a hybrid gat-transformer. J. Mar. Sci. Eng. 13 (8), 1593. https://doi.org/10.3390/ jmse13081593. 

- Xu, L.L., Li, Y.Q., Liu, J.F., Liu, Y., Li, S.G., Wang, L.Y., 2025. Field study and visual simulation of crude oil spill pattern on a south China marine sand beach. J. Environ. Inform. 45 (2), 159–170. https://doi.org/10.3808/jei.202500535. 

- Yan, C., Ji, Z., Ma, S., Wang, X., Zhou, F., 2016. 3d printing as feasible platform for onsite building oil-skimmer for oil collection from spills. Adv. Mater. Interfac. 3 (13), 1600015. https://doi.org/10.1002/admi.201600015. 

- Yang, H., Feng, Q., Xia, S., Wu, Z., Zhang, Y., 2025a. Ai-driven aquaculture: a review of technological innovations and their sustainable impacts. Artif. Intell. Agric. 15 (3), 508–525. https://doi.org/10.1016/j.aiia.2025.01.012. 

- Yang, H., Feng, W., Diao, H., He, Y., Xia, S., 2025b. Artificial intelligence in shale gas and oil: a comprehensive review of applications and challenges. Green Smart Min. Eng. 2 (3), 259–277. https://doi.org/10.1016/j.gsme.2025.09.003. 

- Yang, X., Bi, H., Huang, G., Zhang, H., Lyu, L., An, C., 2025c. Unraveling the resuspension and transformation of stranded oil: mechanisms driving oil-particle aggregate formation in intertidal zones. J. Hazard. Mater. 495, 138966. https://doi. org/10.1016/j.jhazmat.2025.138966. 

- Yang, Y., Liu, Y., Li, G., Zhang, Z., Liu, Y., 2024. Harnessing the power of machine learning for ais data-driven maritime research: a comprehensive review. Transp. Res. Part E Logist. Transp. Rev. 183, 103426. https://doi.org/10.1016/j. tre.2024.103426. 

- Yao, Y.-L., Wang, J.-W., 2024. Multi-usv cooperative oil spill source seeking via extremum seeking combined with information fusion. J. Franklin Inst. 361 (10), 106905. https://doi.org/10.1016/j.jfranklin.2024.106905. 

- Ye, H., Tian, H., Wu, Q., Xue, Y., Xiao, J., Liu, G., Xiong, Y., 2025. Synergistic hierarchical ai framework for usv navigation: closing the loop between swintransformer perception, t-astar planning, and energy-aware td3 control. Sensors (Basel) 25 (15), 4699. https://doi.org/10.3390/s25154699. 

- Ye, X., Chen, B., Lee, K., Storesund, R., Zhang, B., 2020. An integrated offshore oil spill response decision making approach by human factor analysis and fuzzy preference evaluation. Environ. Pollut. 262, 114294. https://doi.org/10.1016/j. envpol.2020.114294. 

- Ye, X., Chen, B., Li, P., Jing, L., Zeng, G., 2019. A simulation-based multi-agent particle swarm optimization approach for supporting dynamic decision making in marine oil spill responses. Ocean Coast Manag. 172, 128–136. https://doi.org/10.1016/j. ocecoaman.2019.02.003. 

- Yin, H., Liu, C., Wu, W., Song, K., Dan, Y., Cheng, G., 2021. An integrated framework for criticality evaluation of oil & gas pipelines based on fuzzy logic inference and machine learning. J. Nat. Gas Sci. Eng. 96, 104264. https://doi.org/10.1016/j. jngse.2021.104264. 

- Zakzouk, M., Abdulaziz, A.M., Abou El-Magd, I., Dahab, A.S., Ali, E.M., 2025. Automated oil spill detection using deep learning and sar satellite data for the northern entrance of the suez canal. Sci. Rep. 15 (1), 20107. https://doi.org/10.1038/s41598-02503028-1. 

- Zare, A., Ablakimova, N., Kaliyev, A.A., Mussin, N.M., Tanideh, N., Rahmanifar, F., Tamadon, A., 2024. An update for various applications of artificial intelligence (ai) for detection and identification of marine environmental pollution: a bibliometric analysis and systematic review. Mar. Pollut. Bull. 206, 116751. https://doi.org/ 10.1016/j.marpolbul.2024.116751. 

- Zhang, C., Feng, Y., Hu, L., Tapete, D., Pan, L., Liang, Z., Cigna, F., Yue, P., 2022. A domain adaptation neural network for change detection with heterogeneous optical and sar remote sensing images. Int. J. Appl. Earth Obs. Geoinf. 109, 102769. https://doi.org/10.1016/j.jag.2022.102769. 

- Zhang, K., Qin, L., Zhu, L., 2025a. Pds-yolo: a real-time detection algorithm for pipeline defect detection. Electronics 14 (1), 208. https://doi.org/10.3390/ electronics14010208. 

- Zhang, M., Taimuri, G., Zhang, J., Zhang, D., Yan, X., Kujala, P., Hirdaris, S., 2025b. Systems driven intelligent decision support methods for ship collision and grounding prevention: present status, possible solutions, and challenges. Reliab. Eng. Syst. Saf. 253, 110489. https://doi.org/10.1016/j.ress.2024.110489. 

- Zhang, Y., Xing, J., Chen, W., Wang, H., Shi, B., Song, Y., Huang, X., Jiang, Z., 2025c. A novel yolov11-driven deep learning algorithm for uav multispectral oil spill detection in inland lakes. J. King Saud Univ. Comput. Inf. Sci. 37 (5), 108. https:// doi.org/10.1007/s44443-025-00117-z. 

- Zhang, L., Lu, J., 2024. Optimizing oil spill emergency logistics: a time-varying multiresource collaborative scheduling model. Environ. Sci. Pollut. Res. Int. 31 (2), 2773–2801. https://doi.org/10.1007/s11356-023-30987-7. 

- Zhong, D., Xia, Z., Zhu, Y., Duan, J., 2023. Overview of predictive maintenance based on digital twin technology. Heliyon 9 (4), e14534. https://doi.org/10.1016/j. heliyon.2023.e14534. 

- Zhou, Q., Wang, S., Liu, J., Hu, X., Liu, Y., He, Y., He, X., Wu, X., 2022. Geological evolution of offshore pollution and its long-term potential impacts on marine ecosystems. Geosci. Front. 13 (5), 101427. https://doi.org/10.1016/j. gsf.2022.101427. 

- Zodiatis, G., De Dominicis, M., Perivoliotis, L., Radhakrishnan, H., Georgoudis, E., Sotillo, M., Lardner, R.W., Krokos, G., Bruciaferri, D., Clementi, E., Guarnieri, A., Ribotti, A., Drago, A., Bourma, E., Padorno, E., Daniel, P., Gonzalez, G., Chazot, C., Gouriou, V., Mancini, M., 2016. The mediterranean decision support system for marine safety dedicated to oil slicks predictions. Deep Sea Res. Part II Top. Stud. Oceanogr. 133, 4–20. https://doi.org/10.1016/j.dsr2.2016.07.014. 

- Zuo, Z., Ma, L., Liang, S., Liang, J., Zhang, H., Liu, T., 2022. A semi-supervised leakage detection method driven by multivariate time series for natural gas gathering pipeline. Process Saf. Environ. Prot. 164, 468–478. https://doi.org/10.1016/j. psep.2022.06.036.
