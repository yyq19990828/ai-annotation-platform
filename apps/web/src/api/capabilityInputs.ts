import { INPUTS, INPUT_IDS, type InputId } from "./generated/capabilityVocab.gen";

const INPUT_ID_SET = new Set<string>(INPUT_IDS);

function expectInputId(value: string): InputId {
  if (!INPUT_ID_SET.has(value)) {
    throw new Error(`Missing capability input id: ${value}`);
  }
  return value as InputId;
}

export const INPUT_FULL_IMAGE_ID = expectInputId("full_image");
export const INPUT_CROP_ID = expectInputId("crop");
export const INPUT_BBOX_PROMPT_ID = expectInputId("bbox_prompt");
export const INPUT_POINT_PROMPT_ID = expectInputId("point_prompt");
export const INPUT_VIDEO_ID = expectInputId("video");

export function isInputId(value: string): value is InputId {
  return INPUT_ID_SET.has(value);
}

export function hasInput(inputs: readonly string[] | null | undefined, input: InputId): boolean {
  return (inputs ?? []).includes(input);
}

export function inputLabel(input: string): string {
  return isInputId(input) ? INPUTS[input].label : input;
}
