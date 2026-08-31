import {
  chatGPTSignInPath,
  chatGPTSignOutPath,
  getChatGPTUser,
} from '@/app/chatgpt-auth';
import { CalibrationApp } from '@/components/calibration-app';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const identity = await getChatGPTUser();
  return (
    <CalibrationApp
      identity={identity}
      signInPath={chatGPTSignInPath('/#settings')}
      signOutPath={chatGPTSignOutPath('/')}
    />
  );
}
