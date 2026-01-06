import type { PreSignUpTriggerEvent, PreSignUpTriggerHandler } from 'aws-lambda';

export const handler: PreSignUpTriggerHandler = async (
  event: PreSignUpTriggerEvent
): Promise<PreSignUpTriggerEvent> => {
  event.response.autoConfirmUser = true;
  event.response.autoVerifyEmail = false;
  return event;
};
