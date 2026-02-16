import * as React from "react";
import { TextInput, TouchableOpacity, View, Text } from "react-native";
import { useSignUp } from "@clerk/clerk-expo";
import { useRouter, Link } from "expo-router";

export default function SignUpScreen() {
  const { isLoaded, signUp, setActive } = useSignUp();
  const router = useRouter();

  const [emailAddress, setEmailAddress] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [pendingVerification, setPendingVerification] = React.useState(false);
  const [code, setCode] = React.useState("");

  const onSignUpPress = async () => {
    if (!isLoaded) {
      return;
    }

    try {
      await signUp.create({
        emailAddress,
        password,
      });

      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });

      setPendingVerification(true);
    } catch (err: any) {
      // See https://clerk.com/docs/custom-flows/error-handling
      // for more info on error handling
      console.error(JSON.stringify(err, null, 2));
    }
  };

  const onPressVerify = async () => {
    if (!isLoaded) {
      return;
    }

    try {
      const completeSignUp = await signUp.attemptEmailAddressVerification({
        code,
      });

      if (completeSignUp.status === "complete") {
        await setActive({ session: completeSignUp.createdSessionId });
        router.replace("/");
      } else {
        console.error(JSON.stringify(completeSignUp, null, 2));
      }
    } catch (err: any) {
      // See https://clerk.com/docs/custom-flows/error-handling
      // for more info on error handling
      console.error(JSON.stringify(err, null, 2));
    }
  };

  return (
    <View className="flex-1 items-center justify-center p-6 bg-white">
      <View className="w-full max-w-sm">
        <Text className="text-3xl font-bold text-primary-600 mb-8 text-center">
          Create Account
        </Text>
        {!pendingVerification && (
          <View>
            <TextInput
              autoCapitalize="none"
              value={emailAddress}
              placeholder="Email..."
              onChangeText={(email) => setEmailAddress(email)}
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
              onPress={onSignUpPress}
              className="w-full bg-primary-600 p-4 rounded-xl items-center shadow-lg shadow-primary-200"
            >
              <Text className="text-white font-bold text-lg">Sign Up</Text>
            </TouchableOpacity>
            <View className="flex-row justify-center mt-4">
              <Text className="text-gray-600">Already have an account? </Text>
              <Link href="/sign-in">
                <Text className="text-primary-600 font-bold">Sign In</Text>
              </Link>
            </View>
          </View>
        )}
        {pendingVerification && (
          <View>
            <Text className="text-gray-600 mb-4 text-center">
              Enter the verification code sent to your email
            </Text>
            <TextInput
              value={code}
              placeholder="Code..."
              onChangeText={(code) => setCode(code)}
              className="w-full p-4 bg-gray-100 rounded-xl mb-6 border border-gray-200"
            />
            <TouchableOpacity
              onPress={onPressVerify}
              className="w-full bg-primary-600 p-4 rounded-xl items-center shadow-lg shadow-primary-200"
            >
              <Text className="text-white font-bold text-lg">Verify Email</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}
