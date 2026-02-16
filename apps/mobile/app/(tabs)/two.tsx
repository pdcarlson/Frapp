import { Text, View, TouchableOpacity } from 'react-native';
import { useAuth } from "@clerk/clerk-expo";
import { Screen } from "@/components/Screen";

export default function SettingsScreen() {
  const { signOut } = useAuth();

  return (
    <Screen>
      <View className="flex-1">
        <Text className="text-2xl font-bold mb-6">Settings</Text>
        
        <View className="bg-gray-50 rounded-2xl p-4 mb-4">
          <Text className="text-gray-500 mb-1 uppercase text-xs font-bold">Account</Text>
          <TouchableOpacity 
            onPress={() => signOut()}
            className="py-3"
          >
            <Text className="text-red-500 font-semibold text-lg">Sign Out</Text>
          </TouchableOpacity>
        </View>

        <View className="bg-gray-50 rounded-2xl p-4">
          <Text className="text-gray-500 mb-1 uppercase text-xs font-bold">App Info</Text>
          <View className="flex-row justify-between py-2">
            <Text className="text-gray-700">Version</Text>
            <Text className="text-gray-400">1.0.0</Text>
          </View>
        </View>
      </View>
    </Screen>
  );
}
