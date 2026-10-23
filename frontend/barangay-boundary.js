(function exposeGeometry(root, factory) {
    const geometry = factory();
    if (typeof module === 'object' && module.exports) module.exports = geometry;
    if (root) root.BarangayGeometry = geometry;
})(typeof globalThis !== 'undefined' ? globalThis : this, function geometryFactory() {
    const boundary = [
        [121.068181,14.759055],[121.081208,14.758775],[121.081317,14.754012],
        [121.084781,14.753785],[121.084528,14.751778],[121.083159,14.749692],
        [121.081282,14.749858],[121.081271,14.746963],[121.078353,14.745345],
        [121.077591,14.742305],[121.075112,14.740230],[121.073074,14.741330],
        [121.072044,14.740354],[121.068793,14.740365],[121.068825,14.739151],
        [121.067227,14.739182],[121.067320,14.758127],[121.067813,14.758158],
        [121.068181,14.759055]
    ];
    function contains(lat, lng) {
        if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng)) || lat == null || lng == null) return false;
        let inside = false;
        for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
            const [xi,yi] = boundary[i], [xj,yj] = boundary[j];
            if ((yi > lat) !== (yj > lat) && lng < (xj-xi)*(lat-yi)/(yj-yi)+xi) inside = !inside;
        }
        return inside;
    }
    const lngs = boundary.map(point => point[0]), lats = boundary.map(point => point[1]);
    const bounds = [[Math.min(...lngs)-.003,Math.min(...lats)-.003],[Math.max(...lngs)+.003,Math.max(...lats)+.003]];
    return { boundary, center: [121.075,14.749], bounds, contains };
});
