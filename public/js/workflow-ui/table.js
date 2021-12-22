/**
 * Format all of the dates in the user's browser timezone.
 */
function formatDates() {
  const dateTds = document.getElementsByClassName('date-td');
  [...dateTds].forEach(
    (element) => {
      const time = parseInt(element.getAttribute('data-time'));
      const formattedDate = (new Date(time)).toLocaleString();
      element.textContent = formattedDate;
    }
  );
}

export {
  formatDates
}