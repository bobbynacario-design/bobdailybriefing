export const ORIGINS = ['MNL','CEB','CRK'];
// Airline pages plus a labelled public press-release fallback. No paid APIs.
export const SOURCES = [
  {id:'pal-manila',airline:'Philippine Airlines',type:'fares',url:'https://flights.philippineairlines.com/en-ph/flights-from-manila'},
  {id:'pal-cebu',airline:'Philippine Airlines',type:'fares',url:'https://flights.philippineairlines.com/en-ph/flights-from-cebu'},
  {id:'cathay-ph',airline:'Cathay Pacific',type:'fares',url:'https://flights.cathaypacific.com/destinations/en_PH/flights-from-philippines'},
  {id:'cathay-us',airline:'Cathay Pacific',type:'fares',url:'https://flights.cathaypacific.com/destinations/en_PH/flights-from-philippines-to-united-states'},
  {id:'cathay-uk',airline:'Cathay Pacific',type:'fares',url:'https://flights.cathaypacific.com/destinations/en_PH/flights-from-philippines-to-united-kingdom'},
  {id:'airasia-ph',airline:'AirAsia',type:'promos',url:'https://www.airasia.com/promotions/ph/'},
  {id:'cebu-promo',airline:'Cebu Pacific',type:'promos',url:'https://www.cebupacificair.com/en-PH/seat-sale'},
  {id:'cebu-announcements',airline:'Cebu Pacific',publisher:'Hello Mnl · press-release fallback',type:'campaign-feed',url:'https://hellomnl.com/tag/cebu-pacific/feed/'},
  {id:'cebu-announcements-backup',airline:'Cebu Pacific',publisher:'Logistics News PH · announcement fallback',type:'campaign-feed',url:'https://logisticsnews.ph/tag/cebu-pacific/feed/'},
  {id:'scoot-manila',airline:'Scoot',type:'fares',url:'https://flights.flyscoot.com/en-ph/flights-from-manila'},
  {id:'scoot-cebu',airline:'Scoot',type:'fares',url:'https://flights.flyscoot.com/en-ph/flights-from-cebu'},
  {id:'scoot-clark',airline:'Scoot',type:'fares',url:'https://flights.flyscoot.com/en-ph/flights-from-clark'}
];
export const USER_AGENT = 'DaybookFlightScout/1.0 (+https://github.com/bobbynacario-design/bobdailybriefing)';
