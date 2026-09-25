type IconName = "chat" | "send" | "back" | "logout" | "plus";

export function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, string> = {
    chat: "M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1-1v-7.5a8.5 8.5 0 0 1 17 0ZM8 10h8M8 14h5",
    send: "m5 12 14-8-4 16-4-6-6-2Zm6 2 8-10",
    back: "m14 5-7 7 7 7",
    logout: "M10 4H5v16h5M9 12h12m-5-5 5 5-5 5",
    plus: "M12 5v14M5 12h14",
  };
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
