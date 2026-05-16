import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { signProjectJwt } from "@local/jwt";

const apiUrl = process.env.API_URL ?? " http://127.0.0.1:54321";
const anonKey = await signProjectJwt({
  sub: "00000000-0000-0000-0000-000000000000",
  role: "anon",
});

describe("local realtime compatibility", () => {
  it("connects via websocket and receives heartbeat", async () => {
    const supabase = createClient(apiUrl, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const email = `rt-connect-${crypto.randomUUID()}@example.test`;
    const password = "password123456";
    const signUp = await supabase.auth.signUp({ email, password });
    expect(signUp.error).toBeNull();
    expect(signUp.data.user?.id).toBeTruthy();

    const userId = signUp.data.user?.id!;

    const channel = supabase
      .channel("test-subscription")
      .on("presence", { event: "sync" }, () => {
        console.log("Presence sync");
      })
      .subscribe((status) => {
        console.log("Subscription status:", status);
      });

    expect(channel.state).not.toBe("closed");
    
    await new Promise((resolve) => setTimeout(resolve, 1000));
    
    supabase.removeChannel(channel);
  });

  it("joins channel and tracks presence", async () => {
    const supabase = createClient(apiUrl, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const email = `rt-presence-${crypto.randomUUID()}@example.test`;
    const password = "password123456";
    const signUp = await supabase.auth.signUp({ email, password });
    expect(signUp.error).toBeNull();
    expect(signUp.data.user?.id).toBeTruthy();

    const userId = signUp.data.user?.id!;
    const username = "test-user-" + userId.slice(0, 8);

    const presenceUpdates: any[] = [];

    const channel = supabase
      .channel(`presence-test-${userId.slice(0, 8)}`)
      .on("presence", { event: "sync" }, () => {
        console.log("Presence sync");
      })
      .on("presence", { event: "join" }, ({ key, newPresences }: any) => {
        presenceUpdates.push({ event: "join", key, newPresences });
      })
      .on("presence", { event: "leave" }, ({ key, leftPresences }: any) => {
        presenceUpdates.push({ event: "leave", key, leftPresences });
      })
      .subscribe((status) => {
        console.log("Subscription status:", status);
      });

    channel.track({
      user_id: userId,
      username,
      online_at: Date.now(),
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    const presenceState = channel.presenceState();
    expect(presenceState).toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 500));
    
    supabase.removeChannel(channel);
  });

  it("broadcasts messages to channel", async () => {
    const supabase = createClient(apiUrl, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const email = `rt-broadcast-${crypto.randomUUID()}@example.test`;
    const password = "password123456";
    const signUp = await supabase.auth.signUp({ email, password });
    expect(signUp.error).toBeNull();
    expect(signUp.data.user?.id).toBeTruthy();

    const userId = signUp.data.user?.id!;

    const channel = supabase
      .channel(`broadcast-test-${userId.slice(0, 8)}`)
      .on("broadcast", { event: "test-event" }, (payload: any) => {
        console.log("Received broadcast:", payload);
      })
      .subscribe((status) => {
        console.log("Subscription status:", status);
      });

    await new Promise((resolve) => setTimeout(resolve, 500));

    channel.send({
      type: "broadcast",
      event: "test-event",
      payload: { message: "hello world", user_id: userId },
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(channel.state).not.toBe("closed");

    supabase.removeChannel(channel);
  });

  it("rejects connections without valid JWT", async () => {
    const client = new WebSocket("ws://127.0.0.1:54321/realtime/v1/?apikey=invalid");

    const errorPromise = new Promise((resolve, reject) => {
      client.onopen = () => {
        client.send(JSON.stringify({ event: "phx_join", topic: "test", ref: "1" }));
      };

      client.onerror = (error) => {
        resolve(error);
      };

      client.onclose = (event) => {
        if (event.code !== 1000) {
          resolve(new Error("Connection closed with error"));
        }
      };

      setTimeout(() => resolve(null), 2000);
    });

    const error = await errorPromise;
    expect(error).toBeTruthy();

    client.close();
  });

  it("handles multiple channels concurrently", async () => {
    const supabase = createClient(apiUrl, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const email = `rt-multi-${crypto.randomUUID()}@example.test`;
    const password = "password123456";
    const signUp = await supabase.auth.signUp({ email, password });
    expect(signUp.error).toBeNull();
    expect(signUp.data.user?.id).toBeTruthy();

    const userId = signUp.data.user?.id!;

    const channels = supabase.getChannels();
    expect(channels.length).toBe(0);

    const channel1 = supabase
      .channel(`multi-test-1-${userId.slice(0, 8)}`)
      .on("broadcast", { event: "test" }, () => {})
      .subscribe();

    const channel2 = supabase
      .channel(`multi-test-2-${userId.slice(0, 8)}`)
      .on("broadcast", { event: "test" }, () => {})
      .subscribe();

    await new Promise((resolve) => setTimeout(resolve, 500));

    const activeChannels = supabase.getChannels();
    expect(activeChannels.length).toBeGreaterThan(1);

    supabase.removeChannel(channel1);
    supabase.removeChannel(channel2);

    await new Promise((resolve) => setTimeout(resolve, 200));

    const finalChannels = supabase.getChannels();
    expect(finalChannels.length).toBeLessThan(activeChannels.length);
  });
});