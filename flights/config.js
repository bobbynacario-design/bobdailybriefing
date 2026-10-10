export const ORIGINS = ['MNL','CEB','CRK'];
// Airline pages plus a labelled public press-release fallback. No paid APIs.
// Country pages list different sample fares from the airport pages, so they
// widen route coverage (Australia, Japan, North America) with the same reader.
export const SOURCES = [
  {id:'pal-manila',airline:'Philippine Airlines',label:'From Manila',type:'fares',url:'https://flights.philippineairlines.com/en-ph/flights-from-manila'},
  {id:'pal-cebu',airline:'Philippine Airlines',label:'From Cebu',type:'fares',url:'https://flights.philippineairlines.com/en-ph/flights-from-cebu'},
  {id:'pal-manila-japan',airline:'Philippine Airlines',label:'Manila → Japan',type:'fares',url:'https://flights.philippineairlines.com/en-ph/flights-from-manila-to-japan'},
  {id:'pal-cebu-japan',airline:'Philippine Airlines',label:'Cebu → Japan',type:'fares',url:'https://flights.philippineairlines.com/en-ph/flights-from-cebu-to-japan'},
  {id:'pal-manila-korea',airline:'Philippine Airlines',label:'Manila → South Korea',type:'fares',url:'https://flights.philippineairlines.com/en-ph/flights-from-manila-to-south-korea'},
  {id:'pal-manila-vietnam',airline:'Philippine Airlines',label:'Manila → Vietnam',type:'fares',url:'https://flights.philippineairlines.com/en-ph/flights-from-manila-to-vietnam'},
  {id:'pal-manila-australia',airline:'Philippine Airlines',label:'Manila → Australia',type:'fares',url:'https://flights.philippineairlines.com/en-ph/flights-from-manila-to-australia'},
  {id:'pal-manila-us',airline:'Philippine Airlines',label:'Manila → United States',type:'fares',url:'https://flights.philippineairlines.com/en-ph/flights-from-manila-to-united-states'},
  {id:'pal-cebu-us',airline:'Philippine Airlines',label:'Cebu → United States',type:'fares',url:'https://flights.philippineairlines.com/en-ph/flights-from-cebu-to-united-states'},
  {id:'cathay-ph',airline:'Cathay Pacific',label:'From the Philippines',type:'fares',url:'https://flights.cathaypacific.com/destinations/en_PH/flights-from-philippines'},
  {id:'cathay-cebu',airline:'Cathay Pacific',label:'From Cebu',type:'fares',url:'https://flights.cathaypacific.com/destinations/en_PH/flights-from-cebu'},
  {id:'cathay-japan',airline:'Cathay Pacific',label:'Philippines → Japan',type:'fares',url:'https://flights.cathaypacific.com/destinations/en_PH/flights-from-philippines-to-japan'},
  {id:'cathay-australia',airline:'Cathay Pacific',label:'Philippines → Australia',type:'fares',url:'https://flights.cathaypacific.com/destinations/en_PH/flights-from-philippines-to-australia'},
  {id:'cathay-us',airline:'Cathay Pacific',label:'Philippines → United States',type:'fares',url:'https://flights.cathaypacific.com/destinations/en_PH/flights-from-philippines-to-united-states'},
  {id:'cathay-canada',airline:'Cathay Pacific',label:'Philippines → Canada',type:'fares',url:'https://flights.cathaypacific.com/destinations/en_PH/flights-from-philippines-to-canada'},
  {id:'cathay-uk',airline:'Cathay Pacific',label:'Philippines → United Kingdom',type:'fares',url:'https://flights.cathaypacific.com/destinations/en_PH/flights-from-philippines-to-united-kingdom'},
  {id:'airasia-ph',airline:'AirAsia',label:'Philippine promotions',type:'promos',url:'https://www.airasia.com/promotions/ph/'},
  {id:'cebu-promo',airline:'Cebu Pacific',label:'Seat-sale page',type:'promos',url:'https://www.cebupacificair.com/en-PH/seat-sale'},
  {id:'cebu-announcements',airline:'Cebu Pacific',label:'Sale announcements',publisher:'Hello Mnl · press-release fallback',type:'campaign-feed',url:'https://hellomnl.com/tag/cebu-pacific/feed/'},
  {id:'cebu-announcements-backup',airline:'Cebu Pacific',label:'Sale announcements',publisher:'Logistics News PH · announcement fallback',type:'campaign-feed',url:'https://logisticsnews.ph/tag/cebu-pacific/feed/'},
  {id:'scoot-manila',airline:'Scoot',label:'From Manila',type:'fares',url:'https://flights.flyscoot.com/en-ph/flights-from-manila'},
  {id:'scoot-cebu',airline:'Scoot',label:'From Cebu',type:'fares',url:'https://flights.flyscoot.com/en-ph/flights-from-cebu'},
  {id:'scoot-clark',airline:'Scoot',label:'From Clark',type:'fares',url:'https://flights.flyscoot.com/en-ph/flights-from-clark'}
];
export const USER_AGENT = 'DaybookFlightScout/1.0 (+https://github.com/bobbynacario-design/bobdailybriefing)';
// Firestore rejects documents over 1 MiB; the scout trims fares well before that.
export const MAX_OFFERS = 400;
