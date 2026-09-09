import { RoomView } from "@/components/room-view";
import { validRoomId } from "@/lib/model";
import { notFound } from "next/navigation";
export default async function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  if (!validRoomId(roomId)) notFound();
  return <RoomView key={roomId} roomId={roomId} />;
}
