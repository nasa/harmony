// logout link
// prepending this to the body since we can't modify the Swagger-generated HTML directly
(function(){
  var bar = document.createElement('div');
  bar.style.cssText = 'text-align: right; padding: 8px 20px 0 20px; background-color: #1b1b1b; font-family: sans-serif;';
  var link = document.createElement('a');
  link.href = '/oauth2/logout';
  link.textContent = 'Logout';
  link.style.cssText = 'color: #fff; font-weight: bold; text-decoration: none;';
  bar.appendChild(link);
  document.body.insertBefore(bar, document.body.firstChild);
})();
