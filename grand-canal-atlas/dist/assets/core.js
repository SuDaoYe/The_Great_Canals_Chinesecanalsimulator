(function () {
  'use strict';
  const project = ([lon, lat]) => [18 + (lon - 72) * 14, 18 + (55 - lat) * 17.1];
  const formatYear = year => year < 0 ? `前${-year}年` : `${year}年`;
  function visibleCanals(data, era, mode) {
    if (mode === 'all') return data.canals;
    if (mode === 'new') return data.canals.filter(c => c.era === era);
    return data.canals.filter(c => c.era === era || c.activeEras.includes(era));
  }
  const linePath = coords => coords.map((p, i) => `${i ? 'L' : 'M'}${project(p).map(n=>n.toFixed(2)).join(',')}`).join(' ');
  window.AtlasCore = {project,formatYear,visibleCanals,linePath};
})();
