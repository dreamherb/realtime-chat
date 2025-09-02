function showModal(message) {
  document.getElementById("alertModalMsg").innerText = message;
  document.getElementById("alertModalOverlay").style.display = "flex";
}
function closeModal() {
  document.getElementById("alertModalOverlay").style.display = "none";
  document.getElementById("alertModalMsg").innerText = "";
}
