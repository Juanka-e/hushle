"use client";

import {
    createContext,
    useContext,
    useEffect,
    useState,
    useRef,
    type ReactNode,
} from "react";
import { io, Socket } from "socket.io-client";
import { SOCKET_CLIENT_AUTH } from "@/lib/socket/protocol-version";

interface SocketContextValue {
    socket: Socket | null;
    isConnected: boolean;
}

const SocketContext = createContext<SocketContextValue>({
    socket: null,
    isConnected: false,
});

export function SocketProvider({ children }: { children: ReactNode }) {
    const [isConnected, setIsConnected] = useState(false);
    const [socket, setSocket] = useState<Socket | null>(null);
    const socketRef = useRef<Socket | null>(null);

    useEffect(() => {
        // Connect to the Socket.IO server
        const socketInstance = io({
            path: "/api/socketio",
            auth: SOCKET_CLIENT_AUTH,
            transports: ["websocket", "polling"],
            tryAllTransports: true,
        });

        socketRef.current = socketInstance;

        socketInstance.on("connect", () => {
            setIsConnected(true);
            setSocket(socketInstance);
        });

        socketInstance.on("disconnect", () => {
            setIsConnected(false);
            setSocket(null);
        });

        return () => {
            socketInstance.disconnect();
            setSocket(null);
        };
    }, []);

    return (
        <SocketContext.Provider
            value={{
                socket,
                isConnected,
            }}
        >
            {children}
        </SocketContext.Provider>
    );
}

export function useSocket() {
    const context = useContext(SocketContext);
    if (!context) {
        throw new Error("useSocket must be used within a SocketProvider");
    }
    return context;
}
