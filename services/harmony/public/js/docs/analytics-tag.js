// google analytics tracking
// appending this to the head since we can't modify the Swagger-generated HTML directly
(function(){
  var dapFederatedAnalyticsScript = document.createElement('script');
  dapFederatedAnalyticsScript.src = "https://dap.digitalgov.gov/Universal-Federated-Analytics-Min.js?agency=NASA&subagency=GSFC&dclink=true";
  dapFederatedAnalyticsScript.id = "_fed_an_ua_tag";
  dapFederatedAnalyticsScript.type = 'text/javascript';
  document.getElementsByTagName('head')[0].appendChild(dapFederatedAnalyticsScript);
})();