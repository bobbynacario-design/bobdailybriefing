// Tripadvisor location keys for the cities the flight scout reaches, plus the
// poker venue cities Flights plans trips to. Each key was checked against
// Xotelo's hotel list on 12 Oct 2026: its hotels sat in that city. Airports
// map a fare's destination to a city; the first city listing an airport wins,
// so ICN fares belong to Seoul while a poker trip to Incheon keeps its own.
// Unlisted destinations get no scouted hotel rates, only search links.
export const HOTEL_CITIES=[
  {city:'Tokyo',location:'g298184',airports:['NRT','HND','TYO']},
  {city:'Osaka',location:'g298566',airports:['KIX','ITM']},
  {city:'Fukuoka',location:'g298207',airports:['FUK']},
  {city:'Sapporo',location:'g298560',airports:['CTS']},
  {city:'Nagoya',location:'g298106',airports:['NGO']},
  {city:'Okinawa',location:'g298224',airports:['OKA']},
  {city:'Hiroshima',location:'g298561',airports:['HIJ']},
  {city:'Seoul',location:'g294197',airports:['ICN','GMP']},
  {city:'Incheon',location:'g297889',airports:['ICN']},
  {city:'Busan',location:'g297884',airports:['PUS']},
  {city:'Jeju',location:'g983296',airports:['CJU']},
  {city:'Hong Kong',location:'g294217',airports:['HKG']},
  {city:'Macau',location:'g664891',airports:['MFM']},
  {city:'Taipei',location:'g293913',airports:['TPE','TSA']},
  {city:'Kaohsiung',location:'g297908',airports:['KHH']},
  {city:'Shanghai',location:'g308272',airports:['PVG','SHA']},
  {city:'Guangzhou',location:'g298555',airports:['CAN']},
  {city:'Singapore',location:'g294265',airports:['SIN']},
  {city:'Bangkok',location:'g293916',airports:['BKK','DMK']},
  {city:'Kuala Lumpur',location:'g298570',airports:['KUL']},
  {city:'Ho Chi Minh City',location:'g293925',airports:['SGN']},
  {city:'Hanoi',location:'g293924',airports:['HAN']},
  {city:'Da Nang',location:'g298085',airports:['DAD']},
  {city:'Phnom Penh',location:'g293940',airports:['PNH']},
  {city:'Sydney',location:'g255060',airports:['SYD']},
  {city:'Melbourne',location:'g255100',airports:['MEL']},
  {city:'Brisbane',location:'g255068',airports:['BNE']},
  {city:'Gold Coast',location:'g255337',airports:['OOL']},
  {city:'Perth',location:'g255103',airports:['PER']},
  {city:'Adelaide',location:'g255093',airports:['ADL']},
  {city:'Hobart',location:'g255097',airports:['HBA']},
  {city:'Auckland',location:'g255106',airports:['AKL']},
  {city:'Los Angeles',location:'g32655',airports:['LAX']},
  {city:'San Francisco',location:'g60713',airports:['SFO']},
  {city:'San Jose',location:'g33020',airports:['SJC']},
  {city:'Sacramento',location:'g32999',airports:['SMF']},
  {city:'San Diego',location:'g60750',airports:['SAN']},
  {city:'Las Vegas',location:'g45963',airports:['LAS']},
  {city:'Phoenix',location:'g31310',airports:['PHX']},
  {city:'Honolulu',location:'g60982',airports:['HNL']},
  {city:'Seattle',location:'g60878',airports:['SEA']},
  {city:'Portland',location:'g52024',airports:['PDX']},
  {city:'New York',location:'g60763',airports:['JFK','EWR','LGA']},
  {city:'Boston',location:'g60745',airports:['BOS']},
  {city:'Washington, D.C.',location:'g28970',airports:['IAD','DCA']},
  {city:'Chicago',location:'g35805',airports:['ORD']},
  {city:'Dallas',location:'g55711',airports:['DFW']},
  {city:'Houston',location:'g56003',airports:['IAH']},
  {city:'San Antonio',location:'g60956',airports:['SAT']},
  {city:'Atlanta',location:'g60898',airports:['ATL']},
  {city:'Orlando',location:'g34515',airports:['MCO']},
  {city:'Raleigh',location:'g49463',airports:['RDU']},
  {city:'Vancouver',location:'g154943',airports:['YVR']},
  {city:'Toronto',location:'g155019',airports:['YYZ']},
  {city:'London',location:'g186338',airports:['LHR','LGW']},
  {city:'Manchester',location:'g187069',airports:['MAN']},
  {city:'Boracay',location:'g294260',airports:['MPH'],market:'domestic'},
  {city:'El Nido',location:'g294255',airports:['ENI'],market:'domestic'},
  {city:'Siargao',location:'g2048776',airports:['IAO'],market:'domestic'},
  {city:'Cebu',location:'g298460',airports:['CEB'],market:'domestic'},
  {city:'Bohol',location:'g294259',airports:['TAG'],market:'domestic'},
  {city:'Puerto Princesa',location:'g294257',airports:['PPS'],market:'domestic'},
  {city:'Manila',location:'g298573',airports:['MNL'],market:'staycation'},
  {city:'Makati',location:'g298450',airports:[],market:'staycation'},
  {city:'Pasay',location:'g298452',airports:[],market:'staycation'}
];
export const HOTEL_API='https://data.xotelo.com/api';
// One room for two adults, the usual booking-site default. Rates are per
// room per night in USD (Xotelo has no PHP); the app converts with its
// dated PH market rate, as it does for USD fares.
export const STAY={rooms:1,adults:2,currency:'USD'};
// Per city: up to HOTELS_PER_CITY well-reviewed hotels in Tripadvisor's
// best-value order, with the cheapest typical room among the rest added as a
// budget pick. A stay's quotes are reused for STAY_TTL_HOURS while its dates
// still match the city's cheapest fare; the hotel list for LIST_TTL_DAYS.
export const HOTELS_PER_CITY=3;
export const STAY_TTL_HOURS=20;
export const LIST_TTL_DAYS=7;
export const MIN_RATING=4;
export const MIN_REVIEWS=150;
export const HOTEL_TYPES=['Hotel','Resort','Resort (All-Inclusive)','Small Hotel'];
