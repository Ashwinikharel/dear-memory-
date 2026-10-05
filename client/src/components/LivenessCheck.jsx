// AWS Rekognition Face Liveness (used when the server runs LIVENESS_MODE=aws).
// Loaded lazily so guests in "basic" mode never download the AWS code.
import { Amplify } from 'aws-amplify';
import { ThemeProvider } from '@aws-amplify/ui-react';
import { FaceLivenessDetector } from '@aws-amplify/ui-react-liveness';
import '@aws-amplify/ui-react/styles.css';

const identityPoolId = import.meta.env.VITE_COGNITO_IDENTITY_POOL_ID;
let configured = false;

function configure() {
  if (configured || !identityPoolId) return;
  Amplify.configure({ Auth: { Cognito: { identityPoolId, allowGuestAccess: true } } });
  configured = true;
}

export default function LivenessCheck({ sessionId, region, onComplete, onError, onCancel }) {
  if (!identityPoolId) {
    return <p className="error">Liveness is not configured. Set VITE_COGNITO_IDENTITY_POOL_ID and rebuild the app.</p>;
  }
  configure();
  return (
    <div className="liveness">
      <ThemeProvider>
        <FaceLivenessDetector
          sessionId={sessionId}
          region={import.meta.env.VITE_AWS_REGION || region}
          onAnalysisComplete={async () => onComplete()}
          onUserCancel={onCancel}
          onError={(e) => onError(e?.error?.message || 'The liveness check could not finish. Please try again.')}
        />
      </ThemeProvider>
    </div>
  );
}
