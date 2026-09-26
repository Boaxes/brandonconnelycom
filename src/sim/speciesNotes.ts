/**
 * Field-log notes for each species, written for this site from the sources listed with each entry
 * (facts from NOAA Fisheries, public domain, and Wikipedia and others, credited; no text copied).
 */
export interface SpeciesNote {
  notes: string;
  size: string;
  depth: string;
  diet: string;
  sources: { title: string; url: string; license: string }[];
}

export const NOTES: Record<string, SpeciesNote> = {
  orca: {
    notes:
      'The largest member of the dolphin family, and impossible to mistake. Two kinds work these waters: fish-eating Southern Residents, an endangered population of just 74 whales at the July 2025 count that lives mostly on Chinook salmon, and Bigg\'s (transient) orcas, which hunt seals, sea lions and porpoises. Each resident family keeps its own learned calls. When boats crowd them, they hunt less and travel more.',
    size: 'up to 9.8 m (32 ft)',
    depth: 'mostly near the surface; dives of several hundred metres',
    diet: 'Residents: salmon, mainly Chinook; Bigg\'s: seals, sea lions, porpoises',
    sources: [
      { title: 'Killer Whale (NOAA Fisheries)', url: 'https://www.fisheries.noaa.gov/species/killer-whale', license: 'Public domain (US government)' },
      { title: 'Orca (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Orca', license: 'CC BY-SA 4.0' },
    ],
  },
  humpback: {
    notes:
      'Whalers cleared humpbacks out of the Salish Sea in the early 1900s, and for most of a century they stayed away. A pair seen in 1988 were the first documented returns; sightings have climbed steadily since about 2005, and hundreds of individuals are now catalogued here, each known by the pattern under its flukes. Inside the Sound they lunge through herring and anchovy in the shallows or feed on krill in deeper water.',
    size: 'up to about 18 m (60 ft)',
    depth: 'usually above 80 m; recorded to 616 m',
    diet: 'krill and small schooling fish such as herring and anchovy',
    sources: [
      { title: 'Humpback Whale (NOAA Fisheries)', url: 'https://www.fisheries.noaa.gov/species/humpback-whale', license: 'Public domain (US government)' },
      { title: 'Humpback whales of the Salish Sea (Encyclopedia of Puget Sound)', url: 'https://www.eopugetsound.org/article/humpback-whales-salish-sea', license: '\u00a9 Puget Sound Institute, UW Tacoma (facts only, no text used)' },
      { title: 'Humpback whale (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Humpback_whale', license: 'CC BY-SA 4.0' },
    ],
  },
  porpoise: {
    notes:
      'Small, dark and shy, usually in twos or threes. It rolls up to breathe with barely a ripple, arching its back, and is gone again. Unlike most of its relatives it will not ride a bow wave and tends to keep clear of boats. It prefers bays, harbours and inlets, which puts it squarely in the way of gillnets and underwater noise.',
    size: '1.5\u20131.7 m (5\u20135.5 ft)',
    depth: 'coastal; usually water shallower than 200 m (650 ft)',
    diet: 'schooling fish such as herring and mackerel; some squid and octopus',
    sources: [
      { title: 'Harbor Porpoise (NOAA Fisheries)', url: 'https://www.fisheries.noaa.gov/species/harbor-porpoise', license: 'Public domain (US government)' },
    ],
  },
  sealion: {
    notes:
      'Loud, barking, and almost always male this far north. Females and pups stay near the breeding islands off southern California and Mexico, while many males travel up the coast each winter to feed off Washington and British Columbia, hauling out on docks, jetties and buoys. The small visible ear flaps mark it as an eared seal. It hunts squid and schooling fish, and has learned to pick catch off fishing lines.',
    size: 'males to 2.3 m (7.5 ft); females to 1.8 m (6 ft)',
    depth: 'most dives under 80 m; recorded to 274 m',
    diet: 'squid, anchovy, mackerel, sardine, rockfish',
    sources: [
      { title: 'California Sea Lion (NOAA Fisheries)', url: 'https://www.fisheries.noaa.gov/species/california-sea-lion', license: 'Public domain (US government)' },
      { title: 'California sea lion (Wikipedia)', url: 'https://en.wikipedia.org/wiki/California_sea_lion', license: 'CC BY-SA 4.0' },
    ],
  },
  chinook: {
    notes:
      'The biggest of the Pacific salmon, hence king salmon; a dark gum line earns it another name, blackmouth. Chinook hatch in rivers, spend a few years at sea eating other fish, then return to their home streams to dig gravel nests and spawn. They are the favourite food of the endangered Southern Resident orcas, and catch limits on this coast are now set with the whales in mind.',
    size: 'typically about 90 cm (3 ft); up to 1.5 m (4.9 ft) and 58 kg',
    depth: 'rivers and estuaries out to the open North Pacific',
    diet: 'adults eat other fish; young eat insects and small crustaceans',
    sources: [
      { title: 'Chinook Salmon (NOAA Fisheries)', url: 'https://www.fisheries.noaa.gov/species/chinook-salmon', license: 'Public domain (US government)' },
      { title: 'Chinook salmon (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Chinook_salmon', license: 'CC BY-SA 4.0' },
    ],
  },
  herring: {
    notes:
      'Dark blue to olive on the back and silver below, so a school is hard to pick out from above or beneath. Each year the adults come inshore to spawn, sticking their eggs to eelgrass and kelp in the shallows, and stop feeding for the week or two it takes. Porpoises, dogfish and humpbacks all lean on them. The Cherry Point stock in Puget Sound has been shrinking since the 1970s.',
    size: 'up to 26 cm (10 in) in Puget Sound',
    depth: 'surface to about 400 m (1,300 ft)',
    diet: 'plankton; adults take larger crustaceans and small fish',
    sources: [
      { title: 'Pacific Herring (NOAA Fisheries)', url: 'https://www.fisheries.noaa.gov/species/pacific-herring', license: 'Public domain (US government)' },
    ],
  },
  rockfish: {
    notes:
      'Mottled copper, brown or olive, best told by the pale stripe along the back half of its lateral line and the bars fanning back from its eyes. Adults sit on or against the rock and rarely move more than about a mile from home; some share a crevice with a giant Pacific octopus. They can live past 50 years. In Puget Sound they interbreed with quillback and brown rockfish, and recreational harvest here is closed.',
    size: 'up to 66 cm (26 in), 4.5 kg',
    depth: 'shallow subtidal to 183 m (600 ft)',
    diet: 'shrimp, crabs, squid, octopus and small fish',
    sources: [
      { title: 'Copper Rockfish (Washington Department of Fish and Wildlife)', url: 'https://wdfw.wa.gov/species-habitats/species/sebastes-caurinus', license: '\u00a9 Washington Department of Fish and Wildlife (facts only, no text used)' },
      { title: 'Copper rockfish (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Copper_rockfish', license: 'CC BY-SA 4.0' },
    ],
  },
  blackrockfish: {
    notes:
      'Where copper rockfish hug the bottom, black rockfish hang in the water above the reef, often in large schools around rock and kelp. Mottled grey-black on the back, pale below; young fish carry a black spot at the rear of the spiny dorsal fin that fades with age. They take six to eight years to mature and can live past 50. They feed up in the water column on plankton, crab larvae and small fish.',
    size: 'up to about 69 cm (27 in), 6 kg',
    depth: 'surface to 366 m; most shallower than about 75 m',
    diet: 'zooplankton, crab larvae, herring, sand lance',
    sources: [
      { title: 'Black Rockfish (Washington Department of Fish and Wildlife)', url: 'https://wdfw.wa.gov/species-habitats/species/sebastes-melanops', license: '\u00a9 Washington Department of Fish and Wildlife (facts only, no text used)' },
      { title: 'Black Rockfish Species Profile (Alaska Department of Fish and Game)', url: 'https://www.adfg.alaska.gov/index.cfm?adfg=blackrockfish.main', license: '\u00a9 Alaska Department of Fish and Game (facts only, no text used)' },
      { title: 'Black rockfish (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Black_rockfish', license: 'CC BY-SA 4.0' },
    ],
  },
  flounder: {
    notes:
      'A flatfish with skin roughened by tiny star-shaped plates, the source of both its names, and bold black-and-orange bars across its fins. It belongs to the right-eyed flounders, yet either side can end up on top. It glides over mud and sand on rippling fin edges and can shade itself to match the bottom. Adults live largely on clams, sometimes just biting off the siphons.',
    size: 'up to 91 cm (36 in), 9 kg',
    depth: 'shore to 375 m; mostly above 146 m',
    diet: 'clams and clam siphons, worms, small crustaceans',
    sources: [
      { title: 'Starry flounder (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Starry_flounder', license: 'CC BY-SA 4.0' },
      { title: 'Starry Flounder (Washington Department of Fish and Wildlife)', url: 'https://wdfw.wa.gov/species-habitats/species/platichthys-stellatus', license: '\u00a9 Washington Department of Fish and Wildlife (facts only, no text used)' },
    ],
  },
  sculpin: {
    notes:
      'Named for the long, straight spine that juts back from each cheek like a bison\'s horn. Blotched brown, green and reddish, it can change shade to disappear against rock and weed, and a line of big raised plates runs high along its side. In late winter several females may lay eggs with one male, who then guards the exposed clutches and fans them with his pectoral fins until they hatch.',
    size: 'up to 37 cm (14.5 in)',
    depth: 'mostly above 20 m (65 ft); recorded past 200 m',
    diet: 'crabs, amphipods, isopods, mussels, small fish',
    sources: [
      { title: 'Enophrys bison (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Enophrys_bison', license: 'CC BY-SA 4.0' },
      { title: 'Buffalo Sculpin (Washington Department of Fish and Wildlife)', url: 'https://wdfw.wa.gov/species-habitats/species/enophrys-bison', license: '\u00a9 Washington Department of Fish and Wildlife (facts only, no text used)' },
    ],
  },
  dogfish: {
    notes:
      'A small grey shark that travels in schools, sometimes thousands strong, often sorted by size and sex. A mildly venomous spine stands in front of each dorsal fin. It grows slowly and lives long: females carry their pups for 18 to 22 months, and some fish pass 80 years. Common in Puget Sound, though tagged dogfish have been tracked leaving the Sound for the outer coast in summer.',
    size: 'adults usually 75\u2013110 cm; can exceed 1.2 m (4 ft)',
    depth: 'surface to about 1,230 m; most above 350 m',
    diet: 'herring and other small schooling fish, shrimp, crabs, squid',
    sources: [
      { title: 'Pacific Spiny Dogfish (NOAA Fisheries)', url: 'https://www.fisheries.noaa.gov/species/pacific-spiny-dogfish', license: 'Public domain (US government)' },
      { title: 'Pacific Spiny Dogfish (Washington Department of Fish and Wildlife)', url: 'https://wdfw.wa.gov/species-habitats/species/squalus-suckleyi', license: '\u00a9 Washington Department of Fish and Wildlife (facts only, no text used)' },
      { title: 'Pacific spiny dogfish (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Pacific_spiny_dogfish', license: 'CC BY-SA 4.0' },
    ],
  },
  dungeness: {
    notes:
      'Broad and hard-shelled, with fairly short legs and claws that end in a distinct hook. Mostly found on sand and in eelgrass, it eats clams, small crustaceans and fish, and scavenges freely, other Dungeness included. It has to molt to grow, and females mate just after molting, before the new shell hardens. Washington\'s recreational crabbers land more than 1.5 million pounds a year, and every female goes back.',
    size: 'shell typically 15\u201318 cm (6\u20137 in) across; males to about 23 cm',
    depth: 'intertidal to about 90 m; recorded to 800 m',
    diet: 'clams, small crustaceans, small fish; scavenges',
    sources: [
      { title: 'Dungeness crab (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Dungeness_crab', license: 'CC BY-SA 4.0' },
      { title: 'Crab fishing regulations (Washington Department of Fish and Wildlife)', url: 'https://wdfw.wa.gov/fishing/shellfishing-regulations/crab', license: '\u00a9 Washington Department of Fish and Wildlife (facts only, no text used)' },
    ],
  },
  redrock: {
    notes:
      'A hairy crab, olive to yellow and often edged with red or orange, with a broad toothed shell and small claws furred in bristles. It clings to eelgrass and can hop from blade to blade, or sits buried in sand and mud just below the tide line. In Washington\'s green crab monitoring traps it is common from April to June and nearly absent after July.',
    size: 'shell up to about 10 cm (4 in) across',
    depth: 'low intertidal to about 40 m',
    diet: 'omnivorous',
    sources: [
      { title: 'Telmessus cheiragonus (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Telmessus_cheiragonus', license: 'CC BY-SA 4.0' },
      { title: 'Hairy Helmet Crabs (Washington Sea Grant Crab Team)', url: 'https://wsgcrabteam.uw.edu/hairy-helmet-crabs/', license: '\u00a9 Washington Sea Grant (facts only, no text used)' },
      { title: 'Telmessus cheiragonus (SeaLifeBase)', url: 'https://www.sealifebase.se/summary/Telmessus-cheiragonus.html', license: '\u00a9 SeaLifeBase (facts only, no text used)' },
    ],
  },
  kelpcrab: {
    notes:
      'A shield-shaped spider crab, smooth and olive-brown on top and often red or orange underneath, with long legs built for climbing kelp and dock pilings. In summer it eats little but seaweed; in winter it turns to barnacles, small mussels and hydroids. It does not dress itself like a decorator crab, though it may hook scraps of kelp on the bristles behind its snout to eat later. The pinch is strong.',
    size: 'shell up to about 9 cm (3.7 in) across',
    depth: 'low intertidal to about 75 m',
    diet: 'kelp and other algae in summer; barnacles, mussels, hydroids in winter',
    sources: [
      { title: 'Pugettia producta (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Pugettia_producta', license: 'CC BY-SA 4.0' },
    ],
  },
  decorator: {
    notes:
      'A slender-legged spider crab with a heart-shaped shell that it plants with sponges, algae, bryozoans and hydroids, fixed on hooked bristles that work like Velcro. The disguise hides both its outline and its scent. Juveniles and females decorate heavily; grown males often go nearly bare. It feeds by sitting still and catching drifting bits of kelp, and is hunted by halibut and octopus.',
    size: 'shell about 5 cm (2 in) long',
    depth: 'intertidal to 436 m',
    diet: 'drifting kelp and algae',
    sources: [
      { title: 'Oregonia gracilis (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Oregonia_gracilis', license: 'CC BY-SA 4.0' },
    ],
  },
  prawn: {
    notes:
      'The largest shrimp in Puget Sound: see-through red with white stripes and a white spot on the first and fifth tail segments. Every spot prawn starts adult life as a male and later turns female. By day they keep to deeper water, rising at dusk to feed and mate. They are the prize of Washington\'s shrimp fisheries, most plentiful in Hood Canal, the San Juans and northern and central Puget Sound.',
    size: 'up to 27 cm (10.5 in); females larger',
    depth: 'a few metres to about 460 m; often near 110 m',
    diet: 'small live prey and carrion',
    sources: [
      { title: 'Pandalus platyceros (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Pandalus_platyceros', license: 'CC BY-SA 4.0' },
      { title: 'Spot Shrimp (Washington Department of Fish and Wildlife)', url: 'https://wdfw.wa.gov/species-habitats/species/pandalus-platyceros', license: '\u00a9 Washington Department of Fish and Wildlife (facts only, no text used)' },
      { title: 'Spot Prawn (Aquarium of the Pacific)', url: 'https://www.aquariumofpacific.org/onlinelearningcenter/species/spot_prawn', license: '\u00a9 Aquarium of the Pacific (facts only, no text used)' },
    ],
  },
  cucumber: {
    notes:
      'A long, leathery, red-brown cylinder lying on rock and gravel, sweeping up detritus with a ring of twenty tentacles around its mouth. Rows of tube feet underneath hold it in place. When threatened it can throw out its internal organs, or sticky threads, to distract an attacker. Mostly active at night, it supports a commercial dive harvest in Washington\'s inland waters, including Puget Sound.',
    size: 'up to 50 cm (20 in) long',
    depth: 'low intertidal to 250 m',
    diet: 'organic detritus sifted from sediment or caught from the current',
    sources: [
      { title: 'California sea cucumber (Wikipedia)', url: 'https://en.wikipedia.org/wiki/California_sea_cucumber', license: 'CC BY-SA 4.0' },
      { title: 'Commercial Sea Cucumber Fishery (Washington Department of Fish and Wildlife)', url: 'https://wdfw.wa.gov/fishing/commercial/sea-cucumber', license: '\u00a9 Washington Department of Fish and Wildlife (facts only, no text used)' },
    ],
  },
  octopus: {
    notes:
      'The world\'s largest octopus: adults usually weigh about 15 kg and can span over 4 m. It spends most of its time tucked into a den, and the litter of shells outside is how divers find one. A female lays more than a hundred thousand eggs, guards them without eating until they hatch, then dies. After a legal harvest in Puget Sound caused an outcry, Washington protected octopus at seven sites.',
    size: 'usually about 15 kg; arm span up to 4.3 m (14 ft)',
    depth: 'intertidal to about 2,000 m',
    diet: 'crabs, shrimp, clams, scallops, snails, fish',
    sources: [
      { title: 'Giant Pacific octopus (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Giant_Pacific_octopus', license: 'CC BY-SA 4.0' },
    ],
  },
  batstar: {
    notes:
      'A thick, stubby star whose arms are joined by webbing almost to the tips, like a bat\'s wing. Usually five-armed, occasionally up to nine, and found in green, purple, red, orange, yellow or brown. It scavenges the bottom for algae and dead animals, pushing its stomach out over food to digest it in place. Small worms often live in the grooves under its arms, eating its scraps.',
    size: 'up to about 20 cm (8 in) across',
    depth: 'intertidal to 300 m',
    diet: 'algae and carrion; some bryozoans',
    sources: [
      { title: 'Patiria miniata (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Patiria_miniata', license: 'CC BY-SA 4.0' },
    ],
  },
  sunflowerstar: {
    notes:
      'Once a dominant predator on Puget Sound reefs: soft-bodied, up to 24 arms, and about 15,000 tube feet that carry it roughly a metre a minute. Sea star wasting disease struck in 2013, and numbers off Washington fell by more than 99 percent. In 2025 a bacterium, Vibrio pectenicida, was identified as a cause. Where it vanished, the urchins it ate have multiplied, at the expense of kelp.',
    size: 'arm span up to 1 m (3.3 ft)',
    depth: 'low intertidal to at least 435 m',
    diet: 'sea urchins, clams, snails, crabs, other sea stars',
    sources: [
      { title: 'Sunflower Sea Star (NOAA Fisheries)', url: 'https://www.fisheries.noaa.gov/species/sunflower-sea-star', license: 'Public domain (US government)' },
      { title: 'Sunflower sea star (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Sunflower_sea_star', license: 'CC BY-SA 4.0' },
    ],
  },
  urchin: {
    notes:
      'A fist-sized ball of short purple spines, grazing the low intertidal and shallow subtidal. Where predators such as sea otters and sunflower stars disappear, purple urchins can multiply until they strip the kelp and leave a bare urchin barren. Some are thought to live 70 years. In 2006 it became the first echinoderm to have its genome fully sequenced.',
    size: 'test about 10 cm (4 in) across',
    depth: 'low intertidal to shallow subtidal',
    diet: 'kelp and other algae',
    sources: [
      { title: 'Strongylocentrotus purpuratus (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Strongylocentrotus_purpuratus', license: 'CC BY-SA 4.0' },
      { title: 'Sunflower sea star (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Sunflower_sea_star', license: 'CC BY-SA 4.0' },
    ],
  },
  sanddollar: {
    notes:
      'A flattened urchin covered in a fuzz of fine spines, its five-petal pattern set off-centre, which gives it its name. Living ones are grey, brown or purple; the white tests on the beach are the dead. In a current, whole beds stand on edge in lined-up rows, front edge buried, catching plankton and detritus. Young ones swallow heavy sand grains as ballast so they are not washed away.',
    size: 'test averages 7.6 cm; up to 12 cm across',
    depth: 'low intertidal to about 90 m; mostly shallow',
    diet: 'plankton, diatoms, small crustaceans, detritus',
    sources: [
      { title: 'Dendraster excentricus (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Dendraster_excentricus', license: 'CC BY-SA 4.0' },
    ],
  },
  moonsnail: {
    notes:
      'The largest of the moon snails, with a round shell up to 14 cm across and a foot so big it folds up over the shell as the snail ploughs through sand. It hunts clams, drilling a neat round hole through the shell and eating the animal inside. To pull back into its shell it has to squeeze out a lot of water. Its eggs go into a curved collar of sand.',
    size: 'shell up to 14 cm (5.5 in) across',
    depth: 'intertidal to 180 m',
    diet: 'clams and other bivalves',
    sources: [
      { title: 'Neverita lewisii (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Neverita_lewisii', license: 'CC BY-SA 4.0' },
    ],
  },
  scallop: {
    notes:
      'It starts life as a swimming scallop, then cements itself to rock at about 4.5 cm and stays put for 20 years or more. The upper shell grows thick and ribbed, and is usually crusted with sponges, barnacles and algae, so it is hard to see until it gapes. Then the orange mantle shows, lined with a row of tiny blue eyes. Inside, the hinge is stained purple.',
    size: 'up to 15 cm intertidal, 25 cm (10 in) subtidal',
    depth: 'low intertidal to about 80 m',
    diet: 'phytoplankton, filtered from the water',
    sources: [
      { title: 'Crassadoma (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Crassadoma', license: 'CC BY-SA 4.0' },
    ],
  },
};
