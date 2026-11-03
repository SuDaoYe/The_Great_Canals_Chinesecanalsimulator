export function waterSeason(tick){
  const month=Math.floor(tick%36/3)+1;
  if(month<=2||month>=11)return {name:'枯水期',symbol:'▽',factor:.7,month};
  if(month>=5&&month<=8)return {name:'丰水期',symbol:'▲',factor:1,month};
  return {name:'平水期',symbol:'◇',factor:.9,month};
}
