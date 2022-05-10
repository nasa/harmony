let toastList;
document.addEventListener("DOMContentLoaded",function(){
  var toastElList = [].slice.call(document.querySelectorAll('.toast'))
  toastList = toastElList.map(function (toastEl) {
    return new bootstrap.Toast(toastEl, { delay: 5000 })
  })
});

/**
 *
 * @param
 */
function setToastText(toastId, text) {
  const toastEl = document.getElementById(toastId);
  const toastBodyEl = toastEl.querySelector('.toast-body');
  toastBodyEl.textContent = text;
}

export default {

  /**
   *
   * @param
   */
  showUpper(text) {
    setToastText('upper-toast', text);
    toastList[0].show();
  },

  /**
   *
   * @param
   */
  showLower(text) {
    setToastText('lower-toast', text);
    toastList[1].show();
  }
}