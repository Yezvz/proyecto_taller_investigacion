// Usuario de prueba
const student = {
    username: "l22251022",
    password: "12345"
};

function login() {
    const usernameInput = document.getElementById("username").value;
    const passwordInput = document.getElementById("password").value;
    const errorMsg = document.getElementById("error-msg");

    if (usernameInput === student.username && passwordInput === student.password) {
        // Redirige al dashboard
        window.location.href = "dashboard.html";
    } else {
        errorMsg.textContent = "Usuario o contraseña incorrectos";
    }
}