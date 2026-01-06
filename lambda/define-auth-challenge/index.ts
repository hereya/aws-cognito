import type {
  DefineAuthChallengeTriggerEvent,
  DefineAuthChallengeTriggerHandler,
} from 'aws-lambda';

export const handler: DefineAuthChallengeTriggerHandler = async (
  event: DefineAuthChallengeTriggerEvent
): Promise<DefineAuthChallengeTriggerEvent> => {
  const session = event.request.session;

  if (session.length === 0) {
    event.response.challengeName = 'CUSTOM_CHALLENGE';
    event.response.issueTokens = false;
    event.response.failAuthentication = false;
  } else if (
    session.length === 1 &&
    session[0].challengeName === 'CUSTOM_CHALLENGE' &&
    session[0].challengeResult === true
  ) {
    event.response.issueTokens = true;
    event.response.failAuthentication = false;
  } else if (session.length >= 3) {
    event.response.issueTokens = false;
    event.response.failAuthentication = true;
  } else {
    event.response.challengeName = 'CUSTOM_CHALLENGE';
    event.response.issueTokens = false;
    event.response.failAuthentication = false;
  }

  return event;
};
