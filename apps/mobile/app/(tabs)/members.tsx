import { Text, View, FlatList, ActivityIndicator } from 'react-native';
import { useMembers } from "@repo/hooks";
import { Screen } from "@/components/Screen";

export default function MembersScreen() {
  const { data: members, isLoading, error } = useMembers();

  if (isLoading) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#8b5cf6" />
          <Text className="mt-4 text-gray-500">Loading members...</Text>
        </View>
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center">
          <Text className="text-red-500">Error: {error.message}</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View className="mb-6">
        <Text className="text-2xl font-bold">Chapter Members</Text>
        <Text className="text-gray-500">Total: {members?.length ?? 0}</Text>
      </View>

      <FlatList
        data={members}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View className="bg-gray-50 p-4 rounded-2xl mb-3 border border-gray-100">
            <Text className="font-bold text-gray-900 mb-1 font-mono text-xs">{item.userId}</Text>
            <View className="flex-row flex-wrap gap-1">
              {item.roleIds.map((roleId) => (
                <View key={roleId} className="bg-primary-100 px-2 py-0.5 rounded-full">
                  <Text className="text-primary-700 text-[10px] font-bold uppercase">{roleId}</Text>
                </View>
              ))}
              {item.roleIds.length === 0 && (
                <Text className="text-gray-400 text-xs italic">No roles</Text>
              )}
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View className="py-10 items-center">
            <Text className="text-gray-400">No members found</Text>
          </View>
        }
      />
    </Screen>
  );
}
