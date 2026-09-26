/**
 * The photo of each species in the field log: public/species/<key>.jpg, from Wikimedia Commons
 * (resized and cropped; see public/species/CREDITS.md). Each is credited under the photo where it's shown.
 */
export const PHOTOS: Record<string, { author: string; license: string; url: string }> = {
  orca: { author: "Robert Pittman, NOAA", license: "Public domain", url: "https://commons.wikimedia.org/wiki/File:Killerwhales_jumping.jpg" },
  humpback: { author: "Juan Cruzado Cortés", license: "CC BY 4.0", url: "https://commons.wikimedia.org/wiki/File:Humpback_whale_breaching_off_Cabo_San_Lucas.jpg" },
  porpoise: { author: "Ecomare/Salko de Wolf", license: "CC BY-SA 4.0", url: "https://commons.wikimedia.org/wiki/File:Ecomare_-_bruinvis_Michael_in_2015_(bruinvis-michael2015-9313-sw).jpg" },
  sealion: { author: "Jonathan Eisen", license: "CC BY 4.0", url: "https://commons.wikimedia.org/wiki/File:California_Sea_Lion,_Monterey,_California,_United_States_imported_from_iNaturalist_photo_203598492.jpg" },
  chinook: { author: "USFWS Fish and Aquatic Conservation", license: "Public domain", url: "https://commons.wikimedia.org/wiki/File:Chinook_Salmon.jpg" },
  herring: { author: "OpenCage", license: "CC BY-SA 2.5", url: "https://commons.wikimedia.org/wiki/File:Clupea_pallasii_by_OpenCage.jpg" },
  rockfish: { author: "Chad King, SIMoN / MBNMS", license: "Public domain", url: "https://commons.wikimedia.org/wiki/File:Sebastes_caurinus_1.jpg" },
  blackrockfish: { author: "Bloopityboop", license: "CC BY-SA 4.0", url: "https://commons.wikimedia.org/wiki/File:Sebastes_melanops_VA_02.jpg" },
  flounder: { author: "Dark jedi requiem", license: "Public domain", url: "https://commons.wikimedia.org/wiki/File:Starry_Flounder.JPG" },
  sculpin: { author: "Stickpen", license: "Public domain", url: "https://commons.wikimedia.org/wiki/File:Enophrysbison.jpg" },
  dogfish: { author: "NOAA", license: "Public domain", url: "https://commons.wikimedia.org/wiki/File:Spiny_dogfish.jpg" },
  dungeness: { author: "Bildflut", license: "CC0", url: "https://commons.wikimedia.org/wiki/File:Dungeness_crab_(Metacarcinus_magister)_2.jpg" },
  redrock: { author: "Mikhail Nevsky", license: "CC BY 4.0", url: "https://commons.wikimedia.org/wiki/File:Helmet_Crab,_%D0%9A%D0%BE%D1%80%D1%81%D0%B0%D0%BA%D0%BE%D0%B2,_%D0%A1%D0%B0%D1%85%D0%B0%D0%BB%D0%B8%D0%BD%D1%81%D0%BA%D0%B0%D1%8F_%D0%BE%D0%B1%D0%BB.,_%D0%A0%D0%BE%D1%81%D1%81%D0%B8%D1%8F_imported_from_iNaturalist_photo_228741241.jpg" },
  kelpcrab: { author: "D. Gordon E. Robertson", license: "CC BY-SA 3.0", url: "https://commons.wikimedia.org/wiki/File:Northern_Kelp_Crab.jpg" },
  decorator: { author: "Ed Bierman", license: "CC BY 2.0", url: "https://commons.wikimedia.org/wiki/File:Graceful_decorator_crab_(Oregonia_gracilis)_with_sponge.jpg" },
  prawn: { author: "Ed Bowlby, NOAA / Olympic Coast NMS", license: "Public domain", url: "https://commons.wikimedia.org/wiki/File:Olympic_Coast_National_Marine_Sanctuary_2010_Pandalus_platyceros.jpg" },
  cucumber: { author: "Eugene van der Pijll", license: "Public domain", url: "https://commons.wikimedia.org/wiki/File:Parastichopus_californicus.jpg" },
  octopus: { author: "R. N. Lea, NOAA", license: "Public domain", url: "https://commons.wikimedia.org/wiki/File:Enteroctopus_dolfeini.jpg" },
  batstar: { author: "Jerry Kirkhart", license: "CC BY 2.0", url: "https://commons.wikimedia.org/wiki/File:Patiria_miniata_(14494899579).jpg" },
  sunflowerstar: { author: "Jerry Kirkhart", license: "CC BY 2.0", url: "https://commons.wikimedia.org/wiki/File:Pycnopodia_helianthoides_SLO_CA.jpg" },
  urchin: { author: "Ed Bierman", license: "CC BY 2.0", url: "https://commons.wikimedia.org/wiki/File:Urchin_(9398869414).jpg" },
  sanddollar: { author: "louisiv826", license: "CC BY 4.0", url: "https://commons.wikimedia.org/wiki/File:Dendraster_excentricus_677671797_(square).jpg" },
  moonsnail: { author: "Ed Bierman", license: "CC BY 2.0", url: "https://commons.wikimedia.org/wiki/File:Euspira_lewisii_3.jpg" },
  scallop: { author: "Steve Lonhart, SIMoN / MBNMS", license: "Public domain", url: "https://commons.wikimedia.org/wiki/File:Crassedoma_giganteum_1.jpg" },
};

export const photoUrl = (key: string) => `${import.meta.env.BASE_URL}species/${key}.jpg`;
