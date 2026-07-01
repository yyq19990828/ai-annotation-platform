import type { ReactNode } from "react";
import type { PetMood } from "./petLines";
import { PixelHumanSprite } from "./PixelHumanSprite";

export type PetSkinId = "pixel-human";

interface PetSkinSpriteProps {
  mood: PetMood;
}

export interface PetSkin {
  id: PetSkinId;
  label: string;
  renderSprite: (props: PetSkinSpriteProps) => ReactNode;
}

const PIXEL_HUMAN_SKIN: PetSkin = {
  id: "pixel-human",
  label: "像素标注员",
  renderSprite: ({ mood }) => <PixelHumanSprite mood={mood} />,
};

export const PET_SKINS = [PIXEL_HUMAN_SKIN] as const;
export const DEFAULT_PET_SKIN = PIXEL_HUMAN_SKIN;
