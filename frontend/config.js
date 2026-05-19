// Central config — loaded by chat.html (and any page that needs CFG)
// app.js defines API_BASE directly; this file makes window.CFG available too.
(function () {
  var base = (typeof API_BASE !== 'undefined' ? API_BASE : null)
           || 'https://krishihr-zuui.onrender.com/api';
  window.CFG = { apiBase: base };
})();
