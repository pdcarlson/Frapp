import { Text, View } from 'react-native';
import { useUser } from "@clerk/clerk-expo";
import { Screen } from "@/components/Screen";

export default function HomeScreen() {
  const { user } = useUser();

  return (
    <Screen>
      <View className="items-center justify-center flex-1">
        <Text className="text-2xl font-bold text-primary-600">Frapp Home</Text>
        <View className="h-px w-4/5 bg-gray-200 my-8" />
        <Text className="text-gray-600">Logged in as:</Text>
        <Text className="text-lg font-medium">{user?.primaryEmailAddress?.emailAddress}</Text>
      </View>
    </Screen>
  );
}
