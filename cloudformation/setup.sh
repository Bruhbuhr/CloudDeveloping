AWS_PROFILE=renovalab
PREFIX=asm3
ENV=test
KEYPAIR=khang-key
IAM_ROLE=asm-LabRole
IAM_INSTANCE_PROFILE=asm-LabInstanceProfile

# Compute resources
aws cloudformation create-stack \
    --stack-name $PREFIX-$ENV-compute-stack \
    --template-body file://compute-resources.yaml \
    --parameters ParameterKey=Prefix,ParameterValue=$PREFIX ParameterKey=Env,ParameterValue=$ENV ParameterKey=KeyPair,ParameterValue=$KEYPAIR ParameterKey=InstanceProfile,ParameterValue=$IAM_INSTANCE_PROFILE \
    --profile=$AWS_PROFILE

aws cloudformation update-stack \
    --stack-name $PREFIX-$ENV-compute-stack \
    --template-body file://compute-resources.yaml \
    --parameters ParameterKey=Prefix,ParameterValue=$PREFIX ParameterKey=Env,ParameterValue=$ENV ParameterKey=KeyPair,ParameterValue=$KEYPAIR ParameterKey=InstanceProfile,ParameterValue=$IAM_INSTANCE_PROFILE \
    --profile=$AWS_PROFILE

# Serverless resources
aws cloudformation create-stack \
    --stack-name $PREFIX-serverless-$ENV-stack \
    --template-body file://serverless-resources.yaml \
    --parameters ParameterKey=Prefix,ParameterValue=$PREFIX ParameterKey=Env,ParameterValue=$ENV ParameterKey=Role,ParameterValue=$IAM_ROLE \
    --profile=$AWS_PROFILE

aws cloudformation update-stack \
    --stack-name $PREFIX-serverless-$ENV-stack \
    --template-body file://serverless-resources.yaml \
    --parameters ParameterKey=Prefix,ParameterValue=$PREFIX ParameterKey=Env,ParameterValue=$ENV ParameterKey=Role,ParameterValue=$IAM_ROLE \
    --profile=$AWS_PROFILE

# Clean resources
aws cloudformation delete-stack \
    --stack-name $PREFIX-$ENV-compute-stack \
    --profile=$AWS_PROFILE

aws cloudformation delete-stack \
    --stack-name $PREFIX-serverless-$ENV-stack \
    --profile=$AWS_PROFILE
