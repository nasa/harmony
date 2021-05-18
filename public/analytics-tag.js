// google analytics tracking
// appending this to the head since we can't modify the Swagger-generated HTML directly
var script = document.createElement('script');
script.src = "https://dap.digitalgov.gov/Universal-Federated-Analytics-Min.js?agency=NASA&subagency=GSFC&dclink=true";
script.id = "_fed_an_ua_tag"
document.getElementsByTagName('head')[0].appendChild(script);