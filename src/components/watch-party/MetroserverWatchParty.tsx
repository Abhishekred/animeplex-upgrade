import React, {useEffect, useRef, useState} from 'react';
import {Modal, Pressable, Text, TextInput, View, ActivityIndicator, ToastAndroid, Platform, Alert} from 'react-native';
import {connectMetroserver, type MetroserverConnection, type MetroserverEvent} from '../../lib/watchParty/metroserverClient';

type Props = {
  visible: boolean;
  onClose: () => void;
  mediaTitle: string;
};

/**
 * Small Metroserver room sheet. The server endpoint is deliberately supplied
 * through EXPO_PUBLIC_METROSERVER_URL; never silently joins a third-party host.
 */
export default function MetroserverWatchParty({visible, onClose, mediaTitle}: Props) {
  const [endpoint, setEndpoint] = useState(process.env.EXPO_PUBLIC_METROSERVER_URL?.trim() ?? '');
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [status, setStatus] = useState<'disconnected'|'connecting'|'connected'>('disconnected');
  const [room, setRoom] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const connection = useRef<MetroserverConnection | null>(null);

  const notify = (message: string) => {
    if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
    else Alert.alert('Watch Party', message);
  };
  const addEvent = (event: MetroserverEvent) => {
    const p = event.payload;
    if (event.type === 'room_created' || event.type === 'join_approved') {
      const code = String(p.roomCode ?? '');
      if (code) setRoom(code);
      setEvents(old => [event.type === 'room_created' ? 'Room created' : 'Joined room', ...old].slice(0, 5));
    } else if (event.type === 'join_rejected' || event.type === 'error') {
      notify(String(p.message ?? p.reason ?? 'Watch Party request failed'));
    } else if (event.type === 'user_joined' || event.type === 'user_left') {
      setEvents(old => [String(p.username ?? event.type.replace('_', ' ')), ...old].slice(0, 5));
    } else {
      setEvents(old => [event.type.replaceAll('_', ' '), ...old].slice(0, 5));
    }
  };

  useEffect(() => {
    if (!visible) return;
    return () => {
      connection.current?.close();
      connection.current = null;
      setStatus('disconnected');
    };
  }, [visible]);

  const connect = () => {
    if (!endpoint.trim() || !name.trim()) {
      notify('Metroserver URL aur display name enter karo');
      return;
    }
    try {
      connection.current?.close();
      const client = connectMetroserver(endpoint.trim(), addEvent, setStatus);
      connection.current = client;
      // Requests are sent after the socket opens, avoiding lost taps while connecting.
      client.socket.addEventListener('open', () => {
        if (roomCode.trim()) client.joinRoom(roomCode.trim(), name.trim());
        else client.createRoom(name.trim());
      }, {once: true});
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not connect to Metroserver');
    }
  };

  const leave = () => {
    connection.current?.leaveRoom();
    connection.current?.close();
    connection.current = null;
    setRoom('');
    setStatus('disconnected');
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.62)'}}>
        <View style={{backgroundColor: '#171717', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, gap: 12}}>
          <Text style={{fontSize: 21, fontWeight: '700', color: 'white'}}>Watch Party</Text>
          <Text style={{color: '#bdbdbd'}} numberOfLines={2}>{mediaTitle || 'AnimePlex video'}</Text>
          <Text style={{color: status === 'connected' ? '#71d99a' : '#f0c674'}}>● {status}</Text>
          <TextInput value={endpoint} onChangeText={setEndpoint} autoCapitalize="none" placeholder="wss://your-metroserver/ws" placeholderTextColor="#888" style={{color: 'white', borderWidth: 1, borderColor: '#444', borderRadius: 10, padding: 12}} />
          <TextInput value={name} onChangeText={setName} placeholder="Your display name" placeholderTextColor="#888" style={{color: 'white', borderWidth: 1, borderColor: '#444', borderRadius: 10, padding: 12}} />
          <TextInput value={roomCode} onChangeText={setRoomCode} autoCapitalize="characters" placeholder="Room code (blank = create room)" placeholderTextColor="#888" style={{color: 'white', borderWidth: 1, borderColor: '#444', borderRadius: 10, padding: 12}} />
          {room ? <Text style={{color: 'white', fontSize: 17}}>Room code: <Text style={{fontWeight: '800'}}>{room}</Text></Text> : null}
          {events.map((event, index) => <Text key={index} style={{color: '#bdbdbd'}} numberOfLines={1}>• {event}</Text>)}
          {status === 'connecting' ? <ActivityIndicator color="white" /> : null}
          <Pressable onPress={connect} style={{backgroundColor: '#e7e7e7', borderRadius: 12, padding: 14, alignItems: 'center'}}><Text style={{fontWeight: '700', color: '#111'}}>{roomCode.trim() ? 'Join room' : 'Create room'}</Text></Pressable>
          {room || status !== 'disconnected' ? <Pressable onPress={leave} style={{padding: 12, alignItems: 'center'}}><Text style={{color: '#ff8a80'}}>Leave room</Text></Pressable> : null}
          <Pressable onPress={onClose} style={{padding: 10, alignItems: 'center'}}><Text style={{color: 'white'}}>Close</Text></Pressable>
          <Text style={{fontSize: 12, color: '#999'}}>Configure a Metroserver you control. Video sync is not enabled until the player integration is connected.</Text>
        </View>
      </View>
    </Modal>
  );
}
