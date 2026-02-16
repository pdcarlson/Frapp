import { useSignIn } from "@clerk/clerk-expo";
import { Link, useRouter } from "expo-router";
import { Text, TextInput, TouchableOpacity, View } from "react-native";
import React from "react";

export default function SignInScreen() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const router = useRouter();

  const [emailAddress, setEmailAddress] = React.useState("");
  const [password, setPassword] = React.useState("");

  const onSignInPress = React.useCallback(async () => {
    if (!isLoaded) {
      return;
    }

    try {
      const signInAttempt = await signIn.create({
        identifier: emailAddress,
        password,
      });

      if (signInAttempt.status === "complete") {
        await setActive({ session: signInAttempt.createdSessionId });
        router.replace("/");
      } else {
        // See https://clerk.com/docs/custom-flows/error-handling
        // for more info on error handling
        console.error(JSON.stringify(signInAttempt, null, 2));
      }
    } catch (err: any) {
      console.error(JSON.stringify(err, null, 2));
    }
  }, [isLoaded, emailAddress, password]);

  return (
    <View className="flex-1 items-center justify-center p-6 bg-white">
      <View className="w-full max-w-sm">
        <Text className="text-3xl font-bold text-primary-600 mb-8 text-center">
          Welcome to Frapp
        </Text>
        <View className="mb-4">
          <TextInput
            autoCapitalize="none"
            value={emailAddress}
            placeholder="Email..."
            onChangeText={(emailAddress) => setEmailAddress(emailAddress)}
            className="w-full p-4 bg-gray-100 rounded-xl mb-4 border border-gray-200"
          />
          <TextInput
            value={password}
            placeholder="Password..."
            secureTextEntry={true}
            onChangeText={(password) => setPassword(password)}
            className="w-full p-4 bg-gray-100 rounded-xl mb-6 border border-gray-200"
          />
          <TouchableOpacity
            onPress={onSignInPress}
            className="w-full bg-primary-600 p-4 rounded-xl items-center shadow-lg shadow-primary-200"
          >
            <Text className="text-white font-bold text-lg">Sign In</Text>
          </TouchableOpacity>
        </View>
        <View className="flex-row justify-center mt-4">
          <Text className="text-gray-600">Don't have an account? </Text>
          <Link href="/sign-up">
            <Text className="text-primary-600 font-bold">Sign Up</Text>
          </Link>
        </View>
      </View>
    </View>
  );
}
