import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { authApi } from '../../lib/api/auth.js';
import { queryClient } from '../../lib/queryClient.js';
import { useAuthStore } from '../../stores/authStore.js';
import { useShopStore } from '../../stores/shopStore.js';
import { toast } from '../../stores/uiStore.js';

const EMPTY_PASSWORD = {
  current_password: '',
  new_password: '',
  confirm: '',
};

const ChangePasswordPage = () => {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const clearShops = useShopStore((state) => state.clear);
  const isAdmin = ['super_admin', 'shop_admin'].includes(user?.role);
  const [pwdForm, setPwdForm] = useState(EMPTY_PASSWORD);
  const [challenge, setChallenge] = useState(null);
  const [otp, setOtp] = useState('');
  const [otpEmail, setOtpEmail] = useState('');

  const pwdMut = useMutation({
    mutationFn: (payload) => authApi.changePassword(payload),
    onSuccess: () => {
      toast.success('Password changed successfully');
      setPwdForm(EMPTY_PASSWORD);
    },
    onError: (err) =>
      toast.error(err?.response?.data?.error?.message || err?.message || 'Could not change password'),
  });

  const requestOtpMut = useMutation({
    mutationFn: () => authApi.requestPasswordOtp({
      target_user_id: user.id,
      current_password: pwdForm.current_password,
    }),
    onSuccess: (response) => {
      setChallenge(response.data.challenge_id);
      setOtpEmail(response.data.email || 'your email');
      toast.success(`OTP sent to ${response.data.email || 'your email'}`);
    },
    onError: (err) =>
      toast.error(err?.response?.data?.error?.message || err?.message || 'Could not send OTP'),
  });

  const confirmOtpMut = useMutation({
    mutationFn: () => authApi.confirmPasswordOtp({
      challenge_id: challenge,
      otp,
      new_password: pwdForm.new_password,
      confirm: pwdForm.confirm,
    }),
    onSuccess: () => {
      toast.success('Password changed. Sign in again with your new password.');
      queryClient.clear();
      clearShops();
      logout();
      navigate('/login', { replace: true });
    },
    onError: (err) =>
      toast.error(err?.response?.data?.error?.message || err?.message || 'Could not change password'),
  });

  const onPwdField = (key) => (e) => {
    setPwdForm((f) => ({ ...f, [key]: e.target.value }));
  };

  const onChangePassword = (e) => {
    e.preventDefault();
    if (!pwdForm.current_password) {
      toast.error('Enter your current password');
      return;
    }
    if (isAdmin && !challenge) {
      requestOtpMut.mutate();
      return;
    }
    if (!pwdForm.new_password || pwdForm.new_password.length < 8) {
      toast.error('New password must be at least 8 characters');
      return;
    }
    if (!/[A-Z]/.test(pwdForm.new_password)) {
      toast.error('Include at least one uppercase letter');
      return;
    }
    if (!/[a-z]/.test(pwdForm.new_password)) {
      toast.error('Include at least one lowercase letter');
      return;
    }
    if (!/[0-9]/.test(pwdForm.new_password)) {
      toast.error('Include at least one number');
      return;
    }
    if (pwdForm.new_password !== pwdForm.confirm) {
      toast.error('Passwords do not match');
      return;
    }
    if (isAdmin) {
      if (!/^\d{6}$/.test(otp)) {
        toast.error('Enter the 6-digit OTP');
        return;
      }
      confirmOtpMut.mutate();
    } else {
      pwdMut.mutate({
        current_password: pwdForm.current_password,
        new_password: pwdForm.new_password,
        confirm: pwdForm.confirm,
      });
    }
  };

  return (
    <>
      <PageHeader
        title="Change Password"
        description="Update your login password"
      />

      <form className="card p-4 max-w-xl space-y-4" onSubmit={onChangePassword}>
        <p className="text-xs text-gray-500">
          {isAdmin
            ? 'Administrator password changes require an email OTP and sign out every device.'
            : 'Changing your password will sign out other devices.'}
        </p>

        <Input
          label="Current password"
          name="current_password"
          type="password"
          value={pwdForm.current_password}
          onChange={onPwdField('current_password')}
          autoComplete="current-password"
          disabled={pwdMut.isPending}
        />

        {isAdmin && challenge ? (
          <Input
            label="Email OTP"
            name="otp"
            inputMode="numeric"
            maxLength={6}
            value={otp}
            onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
            hint={`Sent to ${otpEmail}`}
            disabled={confirmOtpMut.isPending}
          />
        ) : null}

        <Input
          label="New password"
          name="new_password"
          type="password"
          value={pwdForm.new_password}
          onChange={onPwdField('new_password')}
          autoComplete="new-password"
          disabled={pwdMut.isPending}
        />

        <Input
          label="Confirm new password"
          name="confirm"
          type="password"
          value={pwdForm.confirm}
          onChange={onPwdField('confirm')}
          autoComplete="new-password"
          disabled={pwdMut.isPending}
        />

        <div className="flex justify-end pt-1">
          <Button
            type="submit"
            loading={pwdMut.isPending || requestOtpMut.isPending || confirmOtpMut.isPending}
          >
            {isAdmin && !challenge ? 'Send email OTP' : 'Update password'}
          </Button>
        </div>
      </form>
    </>
  );
};

export default ChangePasswordPage;
