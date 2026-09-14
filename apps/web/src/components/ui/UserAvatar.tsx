import { cn } from "@/lib/utils";
import { Avatar as AvatarPrimitive } from "radix-ui";

import { AVATAR_SIZE_CLASS, type AvatarSize } from "./avatarSizes";
import { avatarInitial, resolveAvatarUrl } from "@/utils/avatar";

/**
 * UserAvatar —— 用户头像(图片优先,首字母回退)。
 *
 * 复用 `components/shadcn/ui/avatar.tsx` 的 Radix 原语:图片未加载完成或加载失败时,
 * Radix 自动显示 fallback,因此不需要自己维护 onError 状态。视觉与 `Avatar`(纯首字母)
 * 一致——中性 `bg-muted` 圆片 + 同一份尺寸表,只有「有无图片」不同。
 *
 * `alt=""` + `aria-hidden`:头像与旁边/tooltip 中的姓名重复,读屏不应重复播报。
 */

export interface AvatarUserLike {
  id?: string;
  name?: string | null;
  email?: string | null;
  avatar_initial?: string | null;
  avatar_ref?: string | null;
}

interface UserAvatarProps {
  user: AvatarUserLike;
  size?: AvatarSize;
  className?: string;
}

export function UserAvatar({ user, size = "sm", className }: UserAvatarProps) {
  const url = resolveAvatarUrl(user.avatar_ref);
  const initial = avatarInitial(user.name, user.email, user.avatar_initial);

  return (
    <AvatarPrimitive.Root
      data-slot="user-avatar"
      className={cn(
        "inline-flex shrink-0 select-none overflow-hidden rounded-full border border-border/60 bg-muted",
        AVATAR_SIZE_CLASS[size],
        className,
      )}
    >
      {url ? (
        <AvatarPrimitive.Image
          src={url}
          alt=""
          aria-hidden="true"
          className="size-full object-cover"
        />
      ) : null}
      <AvatarPrimitive.Fallback
        aria-hidden="true"
        className="flex size-full items-center justify-center bg-muted font-semibold text-foreground"
      >
        {initial}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
