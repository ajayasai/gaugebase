import { CalibrationApp } from '@/components/calibration-app';

export const dynamic = 'force-static';

export default function LocalGaugeBasePage() {
  return (
    <CalibrationApp
      identity={null}
      signInPath="/signin-with-chatgpt?return_to=%2F"
      signOutPath="/"
    />
  );
}
