document.addEventListener('DOMContentLoaded', function() {
    // =========================================================
    // PASSWORD TOGGLE
    // =========================================================
    const togglePassword = document.getElementById('togglePassword');
    const passwordInput = document.getElementById('password');

    if (togglePassword && passwordInput) {
        togglePassword.addEventListener('click', function() {
            const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            passwordInput.setAttribute('type', type);
            this.classList.toggle('fa-eye');
            this.classList.toggle('fa-eye-slash');
        });
    }

    // =========================================================
    // ROLE SELECTION
    // =========================================================
    const roleOptions = document.querySelectorAll('.role-option');
    const roleInput = document.getElementById('roleInput');

    roleOptions.forEach(option => {
        option.addEventListener('click', function() {
            roleOptions.forEach(opt => opt.classList.remove('active'));
            this.classList.add('active');
            
            const role = this.getAttribute('data-role');
            if (roleInput) {
                roleInput.value = role;
            }

            const usernameInput = document.getElementById('username');
            const passwordField = document.getElementById('password');

            if (role === 'admin') {
                usernameInput.value = 'admin';
                passwordField.value = 'admin123';
            } else if (role === 'captain') {
                usernameInput.value = 'captain';
                passwordField.value = 'captain123';
            }
        });
    });

    // =========================================================
    // FORGOT PASSWORD MODAL - STEP 1
    // =========================================================
    const forgotLink = document.getElementById('forgotPassword');
    const forgotModal = document.getElementById('forgotModal');
    const cancelReset = document.getElementById('cancelReset');
    const submitReset = document.getElementById('submitReset');
    const resetEmail = document.getElementById('resetEmail');
    const resetTokenDisplay = document.getElementById('resetTokenDisplay');
    const resetTokenValue = document.getElementById('resetTokenValue');

    if (forgotLink && forgotModal) {
        forgotLink.addEventListener('click', function(e) {
            e.preventDefault();
            forgotModal.style.display = 'flex';
            if (resetEmail) resetEmail.focus();
            
            if (resetTokenDisplay) resetTokenDisplay.style.display = 'none';
            if (resetTokenValue) resetTokenValue.textContent = '';
        });
    }

    if (cancelReset && forgotModal) {
        cancelReset.addEventListener('click', function() {
            forgotModal.style.display = 'none';
            if (resetEmail) resetEmail.value = '';
            if (resetTokenDisplay) resetTokenDisplay.style.display = 'none';
        });
    }

    if (submitReset && forgotModal) {
        submitReset.addEventListener('click', async function() {
            const username = resetEmail ? resetEmail.value.trim() : '';
            if (!username) {
                alert('Please enter your username.');
                return;
            }

            submitReset.disabled = true;
            submitReset.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';

            try {
                const response = await apiFetch('/auth/forgot-password', {
                    method: 'POST',
                    body: JSON.stringify({ username })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Failed to send reset request');
                }

                if (resetTokenDisplay) {
                    resetTokenDisplay.style.display = 'block';
                }

                submitReset.disabled = true;
                submitReset.innerHTML = '✅ Request Sent';

                setTimeout(() => {
                    const resetPasswordModal = document.getElementById('resetPasswordModal');
                    if (resetPasswordModal) {
                        forgotModal.style.display = 'none';
                        resetPasswordModal.style.display = 'flex';
                    }
                }, 10000);

            } catch (error) {
                console.error('Error sending reset request:', error);
                alert('Failed to send reset request. Please try again.');
                submitReset.disabled = false;
                submitReset.innerHTML = 'Send Request';
            }
        });
    }

    if (forgotModal) {
        forgotModal.addEventListener('click', function(e) {
            if (e.target === this) {
                this.style.display = 'none';
                if (resetEmail) resetEmail.value = '';
            }
        });
    }

    // =========================================================
    // RESET PASSWORD MODAL - STEP 2
    // =========================================================
    const resetPasswordModal = document.getElementById('resetPasswordModal');
    const cancelResetPassword = document.getElementById('cancelResetPassword');
    const submitResetPassword = document.getElementById('submitResetPassword');
    const resetTokenInput = document.getElementById('resetTokenInput');
    const newPasswordInput = document.getElementById('newPasswordInput');
    const confirmPasswordInput = document.getElementById('confirmPasswordInput');

    if (cancelResetPassword && resetPasswordModal) {
        cancelResetPassword.addEventListener('click', function() {
            resetPasswordModal.style.display = 'none';
            if (resetTokenInput) resetTokenInput.value = '';
            if (newPasswordInput) newPasswordInput.value = '';
            if (confirmPasswordInput) confirmPasswordInput.value = '';
        });
    }

    if (submitResetPassword && resetPasswordModal) {
        submitResetPassword.addEventListener('click', async function() {
            const resetToken = resetTokenInput ? resetTokenInput.value.trim() : '';
            const newPassword = newPasswordInput ? newPasswordInput.value.trim() : '';
            const confirmPassword = confirmPasswordInput ? confirmPasswordInput.value.trim() : '';

            if (!resetToken || !newPassword || !confirmPassword) {
                alert('Please fill in all fields.');
                return;
            }

            if (newPassword.length < 6) {
                alert('New password must be at least 6 characters.');
                return;
            }

            if (newPassword !== confirmPassword) {
                alert('Passwords do not match.');
                return;
            }

            submitResetPassword.disabled = true;
            submitResetPassword.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Resetting...';

            try {
                const response = await apiFetch('/auth/reset-password', {
                    method: 'POST',
                    body: JSON.stringify({ reset_token: resetToken, new_password: newPassword })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Failed to reset password');
                }

                alert('✅ Password reset successful! You can now login with your new password.');

                resetPasswordModal.style.display = 'none';
                if (resetTokenInput) resetTokenInput.value = '';
                if (newPasswordInput) newPasswordInput.value = '';
                if (confirmPasswordInput) confirmPasswordInput.value = '';

                const loginForm = document.getElementById('loginForm');
                if (loginForm) loginForm.reset();

                submitReset.disabled = false;
                submitReset.innerHTML = 'Send Request';
                if (resetTokenDisplay) resetTokenDisplay.style.display = 'none';

            } catch (error) {
                console.error('Error resetting password:', error);
                alert('Failed to reset password. ' + error.message);
            } finally {
                submitResetPassword.disabled = false;
                submitResetPassword.innerHTML = 'Reset Password';
            }
        });
    }

    if (resetPasswordModal) {
        resetPasswordModal.addEventListener('click', function(e) {
            if (e.target === this) {
                this.style.display = 'none';
            }
        });
    }

    // =========================================================
    // 🔥 LOGIN FORM - FIXED: sessionStorage instead of localStorage
    // =========================================================
    const loginForm = document.getElementById('loginForm');
    const loginBtn = document.querySelector('.btn-login');
    const errorMsg = document.getElementById('errorMsg');
    const errorText = document.getElementById('errorText');

    if (loginForm) {
        loginForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            const username = document.getElementById('username').value.trim();
            const password = document.getElementById('password').value.trim();

            if (errorMsg) {
                errorMsg.style.display = 'none';
                errorMsg.classList.remove('locked');
            }

            if (!username || !password) {
                if (errorText) errorText.textContent = 'Please enter both username and password.';
                if (errorMsg) {
                    errorMsg.style.display = 'flex';
                }
                return;
            }

            if (loginBtn) {
                loginBtn.disabled = true;
                loginBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Logging in...';
            }

            try {
                const response = await fetch(`${API_URL}/auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });

                const data = await response.json();

                if (response.status === 429) {
                    if (errorText) {
                        errorText.textContent = data.error || 'Too many failed attempts. Please wait.';
                    }
                    if (errorMsg) {
                        errorMsg.style.display = 'flex';
                        errorMsg.classList.add('locked');
                    }
                    if (loginBtn) {
                        loginBtn.disabled = false;
                        loginBtn.innerHTML = 'Login to System <i class="fa-solid fa-arrow-right"></i>';
                    }
                    return;
                }

                if (!response.ok) {
                    let errorMessage = data.error || 'Invalid username or password.';
                    
                    if (data.attempts_left !== undefined && data.attempts_left > 0) {
                        errorMessage += ` You have ${data.attempts_left} attempt${data.attempts_left > 1 ? 's' : ''} left.`;
                    }
                    
                    if (data.locked === true) {
                        errorMessage = '⚠️ Too many failed login attempts. Your account is temporarily locked. Please wait 15 minutes before trying again.';
                        if (errorMsg) {
                            errorMsg.classList.add('locked');
                        }
                    }
                    
                    if (errorText) errorText.textContent = errorMessage;
                    if (errorMsg) {
                        errorMsg.style.display = 'flex';
                    }
                    if (loginBtn) {
                        loginBtn.disabled = false;
                        loginBtn.innerHTML = 'Login to System <i class="fa-solid fa-arrow-right"></i>';
                    }
                    return;
                }

                // ✅ SUCCESS - Login successful
                const user = data.user;
                const sessionToken = data.session_token;
                
                // ✅ FIXED: Save to sessionStorage (consistent with apiHelper.js)
                sessionStorage.setItem('token', sessionToken);
                sessionStorage.setItem('user', JSON.stringify({
                    id: user.id,
                    name: user.name,
                    username: user.username,
                    role: user.role,
                    is_active: user.is_active,
                    last_login_at: user.last_login_at || new Date().toISOString()
                }));
                sessionStorage.setItem('isLoggedIn', 'true');
                sessionStorage.setItem('lastLogin', new Date().toLocaleString());

                // ✅ Also save to localStorage for backward compatibility (optional)
                try {
                    localStorage.setItem('user', JSON.stringify({
                        id: user.id,
                        name: user.name,
                        username: user.username,
                        role: user.role,
                        is_active: user.is_active,
                        last_login_at: user.last_login_at || new Date().toISOString()
                    }));
                    localStorage.setItem('isLoggedIn', 'true');
                } catch (e) {}

                console.log('✅ User logged in:', user.name);
                console.log('📋 Role:', user.role);
                console.log('🔑 Session Token Saved to sessionStorage');

                window.location.href = 'dashboard.html';

            } catch (error) {
                console.error('Login error:', error);
                if (errorText) errorText.textContent = 'Unable to connect to server. Please try again.';
                if (errorMsg) {
                    errorMsg.style.display = 'flex';
                }
                if (loginBtn) {
                    loginBtn.disabled = false;
                    loginBtn.innerHTML = 'Login to System <i class="fa-solid fa-arrow-right"></i>';
                }
            }
        });
    }

    // Enter key support
    const passwordField = document.getElementById('password');
    if (passwordField) {
        passwordField.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                const form = document.getElementById('loginForm');
                if (form) form.dispatchEvent(new Event('submit'));
            }
        });
    }
});